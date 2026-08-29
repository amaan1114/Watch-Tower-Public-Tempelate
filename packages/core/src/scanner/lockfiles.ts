import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { DependencyUsage, Workspace } from "../schemas/snapshot.js";

export interface LockfileResolver {
  resolve(workspace: Workspace, packageName: string): string | null;
}

export async function loadLockfileResolver(input: {
  rootPath: string;
  packageManager: "pnpm" | "npm";
}): Promise<LockfileResolver> {
  return input.packageManager === "pnpm" ? loadPnpmResolver(input.rootPath) : loadNpmResolver(input.rootPath);
}

async function loadPnpmResolver(rootPath: string): Promise<LockfileResolver> {
  const raw: unknown = parse(await readFile(path.join(rootPath, "pnpm-lock.yaml"), "utf8"));
  if (!isRecord(raw) || !isRecord(raw.importers)) throw new Error("pnpm-lock.yaml does not contain an importers object.");
  const importers = raw.importers;

  return {
    resolve(workspace, packageName) {
      const importer = importers[workspace.path];
      if (!isRecord(importer)) return null;
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
        const dependencies = importer[section];
        if (!isRecord(dependencies) || !(packageName in dependencies)) continue;
        return pnpmVersion(dependencies[packageName]);
      }
      return null;
    },
  };
}

async function loadNpmResolver(rootPath: string): Promise<LockfileResolver> {
  const content = await readFile(path.join(rootPath, "package-lock.json"), "utf8");
  const raw: unknown = JSON.parse(content);
  if (!isRecord(raw)) throw new Error("package-lock.json must contain an object.");
  const packages = isRecord(raw.packages) ? raw.packages : null;
  const rootDependencies = isRecord(raw.dependencies) ? raw.dependencies : null;

  return {
    resolve(workspace, packageName) {
      if (packages) {
        for (const packagePath of npmCandidatePaths(workspace.path, packageName)) {
          const entry = packages[packagePath];
          if (isRecord(entry) && typeof entry.version === "string") return entry.version;
        }
      }
      const legacy = rootDependencies?.[packageName];
      return isRecord(legacy) && typeof legacy.version === "string" ? legacy.version : null;
    },
  };
}

export function applyResolvedVersions(input: {
  dependencies: Array<{ name: string; usages: DependencyUsage[] }>;
  workspaces: Workspace[];
  resolver: LockfileResolver;
}): void {
  const workspaceById = new Map(input.workspaces.map((workspace) => [workspace.id, workspace]));
  for (const dependency of input.dependencies) {
    for (const usage of dependency.usages) {
      const workspace = workspaceById.get(usage.workspaceId);
      if (!workspace) throw new Error(`Cannot resolve dependency: unknown workspace ${usage.workspaceId}.`);
      usage.resolved = input.resolver.resolve(workspace, dependency.name);
    }
  }
}

function pnpmVersion(value: unknown): string | null {
  const raw = typeof value === "string" ? value : isRecord(value) && typeof value.version === "string" ? value.version : null;
  if (!raw || raw.startsWith("link:") || raw.startsWith("file:") || raw.startsWith("workspace:")) return null;
  // pnpm may encode peer suffixes such as 1.2.3(react@19.0.0) in importers.
  return raw.replace(/\(.+\)$/, "");
}

function npmCandidatePaths(workspacePath: string, packageName: string): string[] {
  const packageSuffix = `node_modules/${packageName}`;
  if (workspacePath === ".") return [packageSuffix];
  return [`${workspacePath}/${packageSuffix}`, packageSuffix];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
