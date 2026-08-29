import * as semver from "semver";
import { z } from "zod";
import type { ExternalDependency } from "../../schemas/snapshot.js";

const REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 12_000;

const NpmPackageDocumentSchema = z.object({
  "dist-tags": z.record(z.string()).default({}),
  time: z.record(z.string()).default({}),
  versions: z.record(z.object({ deprecated: z.union([z.string(), z.boolean()]).optional() }).passthrough()).default({}),
});

export type NpmPackageMetadata = {
  latest: string | null;
  stableVersions: string[];
  publishedAtByVersion: Map<string, string>;
  deprecationByVersion: Map<string, string | null>;
};

export type StablePackageVersion = {
  version: string;
  publishedAt: string | null;
  deprecation: string | null;
};

export type StableVersionCatalog = {
  packageName: string;
  latest: string | null;
  versions: StablePackageVersion[];
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class NpmRegistryClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #cacheTtlMs: number;
  readonly #cache = new Map<string, { expiresAt: number; metadata: NpmPackageMetadata }>();

  constructor(options: { fetch?: FetchLike; timeoutMs?: number; cacheTtlMs?: number } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#cacheTtlMs = options.cacheTtlMs ?? 15 * 60_000;
  }

  async getPackageMetadata(name: string): Promise<NpmPackageMetadata> {
    const cached = this.#cache.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.metadata;
    const response = await this.#fetch(`${REGISTRY_URL}/${encodeURIComponent(name)}`, {
      headers: { accept: "application/json", "user-agent": "Watchtower/0.1" },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`npm Registry returned ${response.status} for ${name}.`);

    const document = NpmPackageDocumentSchema.parse(await response.json());
    const stableVersions = Object.keys(document.versions).filter(isStableVersion).sort(semver.rcompare);
    const latestCandidate = document["dist-tags"].latest;
    const latest = latestCandidate && isStableVersion(latestCandidate)
      ? latestCandidate
      : stableVersions[0] ?? null;
    const publishedAtByVersion = new Map(
      Object.entries(document.time).filter(([version, publishedAt]) => semver.valid(version) !== null && isDate(publishedAt)),
    );
    const deprecationByVersion = new Map(
      Object.entries(document.versions).map(([version, metadata]) => [
        version,
        typeof metadata.deprecated === "string" ? metadata.deprecated.trim() || null : null,
      ]),
    );

    const metadata = { latest, stableVersions, publishedAtByVersion, deprecationByVersion };
    this.#cache.set(name, { metadata, expiresAt: Date.now() + this.#cacheTtlMs });
    return metadata;
  }

  async getStableVersionCatalog(packageName: string): Promise<StableVersionCatalog> {
    const metadata = await this.getPackageMetadata(packageName);
    const versions = metadata.stableVersions
      .map((version) => ({
        version,
        publishedAt: metadata.publishedAtByVersion.get(version) ?? null,
        deprecation: metadata.deprecationByVersion.get(version) ?? null,
      }));
    return { packageName, latest: metadata.latest, versions };
  }
}

export async function enrichWithNpmMetadata(input: {
  dependencies: ExternalDependency[];
  scannedAt: Date;
  client?: NpmRegistryClient;
  concurrency?: number;
}): Promise<Array<{ stage: "npm-registry"; message: string }>> {
  const client = input.client ?? new NpmRegistryClient();
  const errors: Array<{ stage: "npm-registry"; message: string }> = [];
  const results = await mapWithConcurrency(input.dependencies, input.concurrency ?? 6, async (dependency) => {
    try {
      return { dependency, metadata: await client.getPackageMetadata(dependency.name) };
    } catch (error) {
      errors.push({
        stage: "npm-registry",
        message: `${dependency.name}: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { dependency, metadata: null };
    }
  });

  for (const { dependency, metadata } of results) {
    if (!metadata) continue;
    dependency.latest = metadata.latest;
    for (const usage of dependency.usages) {
      if (!usage.resolved || !semver.valid(usage.resolved)) continue;
      usage.deprecation = {
        isDeprecated: metadata.deprecationByVersion.get(usage.resolved) !== null,
        message: metadata.deprecationByVersion.get(usage.resolved) ?? null,
      };
      usage.update = toUpdate(usage.resolved, metadata, input.scannedAt);
    }
  }

  return errors;
}

function toUpdate(resolved: string, metadata: NpmPackageMetadata, scannedAt: Date): ExternalDependency["usages"][number]["update"] {
  if (!metadata.latest || !semver.gt(metadata.latest, resolved)) return null;
  const firstNewerVersion = [...metadata.publishedAtByVersion.keys()]
    .filter((version) => isStableVersion(version) && semver.gt(version, resolved))
    .sort(semver.compare)[0];
  if (!firstNewerVersion) return null;

  const behindSince = metadata.publishedAtByVersion.get(firstNewerVersion) ?? null;
  return {
    type: updateType(resolved, metadata.latest),
    firstNewerVersion,
    behindSince,
    behindDays: behindSince === null ? null : daysBetween(new Date(behindSince), scannedAt),
  };
}

function updateType(from: string, to: string): "major" | "minor" | "patch" {
  const previous = semver.parse(from);
  const latest = semver.parse(to);
  if (!previous || !latest) throw new Error(`Cannot classify invalid semver versions: ${from} -> ${to}.`);
  if (previous.major !== latest.major) return "major";
  if (previous.minor !== latest.minor) return "minor";
  return "patch";
}

function isStableVersion(version: string): boolean {
  const parsed = semver.parse(version);
  return parsed !== null && parsed.prerelease.length === 0;
}

function isDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
