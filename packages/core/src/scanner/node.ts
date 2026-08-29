import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse } from "yaml";
import { applyResolvedVersions, loadLockfileResolver } from "./lockfiles.js";
import { enrichWithNpmMetadata, type NpmRegistryClient } from "./registry/npm.js";
import { enrichWithOsv, type OsvClient } from "./security/osv.js";

import type {
  DependencySection,
  DependencyUsage,
  ExternalDependency,
  ProjectSnapshot,
  Workspace,
} from "../schemas/snapshot.js";

const IGNORED_DIRECTORIES = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/coverage/**"];
const DEPENDENCY_SECTIONS: DependencySection[] = ["dependencies", "devDependencies", "optionalDependencies"];

type Manifest = {
  name?: unknown;
  version?: unknown;
  workspaces?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
};

export type NodeDetection = {
  packageManager: "pnpm" | "npm";
  monorepo: boolean;
};

type DiscoveredManifest = {
  workspace: Workspace;
  manifest: Manifest;
};

export async function scanNodeProject(input: {
  rootPath: string;
  id: string;
  name: string;
  repository?: string;
  scannedAt?: Date;
  registryClient?: NpmRegistryClient | false;
  osvClient?: OsvClient | false;
}): Promise<ProjectSnapshot> {
  const rootPath = path.resolve(input.rootPath);
  const scannedAt = input.scannedAt ?? new Date();
  const rootManifest = await readManifest(path.join(rootPath, "package.json"));
  if (!rootManifest) {
    throw new Error(`No root package.json found at ${rootPath}. Watchtower V1 supports Node repositories with a root package.json.`);
  }

  const detection = await detectNodeProject(rootPath, rootManifest);
  const manifests = await discoverManifests(rootPath, rootManifest, detection.monorepo);
  const { internalDependencies, dependencies } = buildDependencyMaps(manifests);
  const resolver = await loadLockfileResolver({ rootPath, packageManager: detection.packageManager });
  applyResolvedVersions({ dependencies, workspaces: manifests.map(({ workspace }) => workspace), resolver });
  for (const dependency of dependencies) {
    dependency.versionMismatch.resolved = new Set(
      dependency.usages.flatMap((usage) => (usage.resolved === null ? [] : [usage.resolved])),
    ).size > 1;
  }
  const registryErrors = input.registryClient === false
    ? []
    : await enrichWithNpmMetadata({
        dependencies,
        scannedAt,
        client: input.registryClient,
      });
  const securityErrors = input.osvClient === false ? [] : await enrichWithOsv({ dependencies, client: input.osvClient });

  return {
    id: input.id,
    name: input.name,
    repository: input.repository ?? null,
    scan: {
      status: registryErrors.length + securityErrors.length > 0 ? "partial" : "success",
      errors: [...registryErrors, ...securityErrors],
    },
    node: detection,
    workspaces: manifests.map(({ workspace }) => workspace),
    internalDependencies,
    dependencies,
    summary: summarizeDependencies(dependencies),
  };
}

function summarizeDependencies(dependencies: ExternalDependency[]): ProjectSnapshot["summary"] {
  const usages = dependencies.flatMap((dependency) => dependency.usages);
  const dependenciesWithUpdates = dependencies.filter((dependency) => dependency.usages.some((usage) => usage.update !== null));
  const majorUpdateCount = dependencies.filter((dependency) => dependency.usages.some((usage) => usage.update?.type === "major")).length;
  const routineUpdateCount = dependencies.filter((dependency) =>
    dependency.usages.some((usage) => usage.update !== null && usage.update.type !== "major" && !usage.security?.vulnerable),
  ).length;
  return {
    externalDependencyCount: dependencies.length,
    externalUsageCount: usages.length,
    availableUpdateCount: dependenciesWithUpdates.length,
    majorUpdateCount,
    routineUpdateCount,
    vulnerableUsageCount: usages.filter((usage) => usage.security?.vulnerable).length,
    deprecatedUsageCount: usages.filter((usage) => usage.deprecation?.isDeprecated).length,
    declaredVersionMismatchCount: dependencies.filter((dependency) => dependency.versionMismatch.declared).length,
    resolvedVersionMismatchCount: dependencies.filter((dependency) => dependency.versionMismatch.resolved).length,
  };
}

async function detectNodeProject(rootPath: string, rootManifest: Manifest): Promise<NodeDetection> {
  const [hasPnpmLock, hasNpmLock] = await Promise.all([
    fileExists(path.join(rootPath, "pnpm-lock.yaml")),
    fileExists(path.join(rootPath, "package-lock.json")),
  ]);

  if (hasPnpmLock === hasNpmLock) {
    const found = hasPnpmLock ? "both pnpm-lock.yaml and package-lock.json" : "neither pnpm-lock.yaml nor package-lock.json";
    throw new Error(`Cannot determine package manager: found ${found}. Watchtower V1 requires exactly one supported lockfile.`);
  }

  return {
    packageManager: hasPnpmLock ? "pnpm" : "npm",
    monorepo: await workspacePatterns(rootPath, rootManifest).then((patterns) => patterns.length > 0),
  };
}

async function discoverManifests(rootPath: string, rootManifest: Manifest, monorepo: boolean): Promise<DiscoveredManifest[]> {
  const root = toWorkspace(".", rootManifest);
  if (!monorepo) return [{ workspace: root, manifest: rootManifest }];

  const patterns = await workspacePatterns(rootPath, rootManifest);
  const entries = await fg(patterns.map((pattern) => `${normalizePattern(pattern)}/package.json`), {
    cwd: rootPath,
    onlyFiles: true,
    unique: true,
    ignore: IGNORED_DIRECTORIES,
  });

  const nested = await Promise.all(
    entries
      .filter((manifestPath) => manifestPath !== "package.json")
      .sort()
      .map(async (manifestPath) => {
        const manifest = await readManifest(path.join(rootPath, manifestPath));
        if (!manifest) return null;
        return { workspace: toWorkspace(path.dirname(manifestPath), manifest), manifest };
      }),
  );

  return [{ workspace: root, manifest: rootManifest }, ...nested.filter((item): item is DiscoveredManifest => item !== null)];
}

async function workspacePatterns(rootPath: string, rootManifest: Manifest): Promise<string[]> {
  const pnpmWorkspacePath = path.join(rootPath, "pnpm-workspace.yaml");
  if (await fileExists(pnpmWorkspacePath)) {
    const raw = parse(await readFile(pnpmWorkspacePath, "utf8"));
    return readStringArray(raw?.packages, "pnpm-workspace.yaml packages");
  }

  if (Array.isArray(rootManifest.workspaces)) return readStringArray(rootManifest.workspaces, "package.json workspaces");
  if (isRecord(rootManifest.workspaces)) return readStringArray(rootManifest.workspaces.packages, "package.json workspaces.packages");
  return [];
}

function buildDependencyMaps(manifests: DiscoveredManifest[]): {
  internalDependencies: ProjectSnapshot["internalDependencies"];
  dependencies: ExternalDependency[];
} {
  const workspaceByName = new Map(
    manifests.flatMap(({ workspace }) => (workspace.name ? [[workspace.name, workspace] as const] : [])),
  );
  const internalDependencies: ProjectSnapshot["internalDependencies"] = [];
  const external = new Map<string, DependencyUsage[]>();

  for (const { workspace, manifest } of manifests) {
    for (const section of DEPENDENCY_SECTIONS) {
      const entries = dependencyEntries(manifest[section], `${workspace.manifestPath} ${section}`);
      for (const [name, declared] of entries) {
        const internalTarget = workspaceByName.get(name);
        if (internalTarget) {
          internalDependencies.push({ fromWorkspaceId: workspace.id, toWorkspaceId: internalTarget.id, declared });
          continue;
        }
        const usages = external.get(name) ?? [];
        usages.push({ workspaceId: workspace.id, section, declared, resolved: null, update: null, deprecation: null, security: null });
        external.set(name, usages);
      }
    }
  }

  return {
    internalDependencies,
    dependencies: [...external.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, usages]) => ({
        name,
        ecosystem: "npm" as const,
        latest: null,
        usages,
        versionMismatch: {
          declared: new Set(usages.map((usage) => usage.declared)).size > 1,
          resolved: false,
        },
      })),
  };
}

function toWorkspace(workspacePath: string, manifest: Manifest): Workspace {
  const normalizedPath = workspacePath === "." ? "." : workspacePath.split(path.sep).join("/");
  const name = typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : null;
  return {
    id: name ?? `path:${normalizedPath}`,
    name,
    path: normalizedPath,
    manifestPath: normalizedPath === "." ? "package.json" : `${normalizedPath}/package.json`,
    version: typeof manifest.version === "string" ? manifest.version : null,
  };
}

async function readManifest(manifestPath: string): Promise<Manifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!isRecord(parsed)) throw new Error("package.json must contain an object");
    return parsed;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Error(`Could not parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function dependencyEntries(value: unknown, label: string): Array<[string, string]> {
  if (value === undefined) return [];
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return Object.entries(value).map(([name, version]) => {
    if (typeof version !== "string") throw new Error(`${label}.${name} must be a string.`);
    return [name, version];
  });
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/^\.\//, "").replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
