import { z } from "zod";
import * as semver from "semver";
import type { ExternalDependency } from "../../schemas/snapshot.js";

const OSV_URL = "https://api.osv.dev/v1";
const DEFAULT_TIMEOUT_MS = 12_000;

const BatchResponseSchema = z.object({
  results: z.array(z.object({ vulns: z.array(z.object({ id: z.string() })).default([]) }).default({})),
});
const VulnerabilitySchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()).default([]),
  database_specific: z.object({ severity: z.string().optional() }).passthrough().optional(),
  references: z.array(z.object({ type: z.string().optional(), url: z.string().url() })).default([]),
  affected: z
    .array(
      z.object({
        package: z.object({ name: z.string() }).optional(),
        ranges: z.array(z.object({ type: z.string(), events: z.array(z.record(z.string())) })).default([]),
      }),
    )
    .default([]),
});

export type Advisory = {
  id: string;
  aliases: string[];
  url: string | null;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  affectedRange: string | null;
  fixedVersion: string | null;
};

type Query = { name: string; version: string };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OsvClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #details = new Map<string, Promise<z.infer<typeof VulnerabilitySchema>>>();

  constructor(options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getAdvisories(queries: Query[]): Promise<Map<string, Advisory[]>> {
    if (queries.length === 0) return new Map();
    const response = await this.#fetch(`${OSV_URL}/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": "Watchtower/0.1" },
      body: JSON.stringify({ queries: queries.map((query) => ({ package: { ecosystem: "npm", name: query.name }, version: query.version })) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`OSV querybatch returned ${response.status}.`);
    const batch = BatchResponseSchema.parse(await response.json());
    if (batch.results.length !== queries.length) throw new Error("OSV querybatch returned a result count that does not match its queries.");

    const result = new Map<string, Advisory[]>();
    await Promise.all(
      batch.results.map(async (batchResult, index) => {
        const query = queries[index];
        const vulnerabilities = await Promise.all(batchResult.vulns.map(({ id }) => this.getVulnerability(id)));
        result.set(queryKey(query), vulnerabilities.map((vulnerability) => normalizeAdvisory(vulnerability, query.name, query.version)));
      }),
    );
    return result;
  }

  private getVulnerability(id: string): Promise<z.infer<typeof VulnerabilitySchema>> {
    const existing = this.#details.get(id);
    if (existing) return existing;
    const request = (async () => {
      const response = await this.#fetch(`${OSV_URL}/vulns/${encodeURIComponent(id)}`, {
        headers: { accept: "application/json", "user-agent": "Watchtower/0.1" },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) throw new Error(`OSV advisory ${id} returned ${response.status}.`);
      return VulnerabilitySchema.parse(await response.json());
    })();
    this.#details.set(id, request);
    return request;
  }
}

export async function enrichWithOsv(input: {
  dependencies: ExternalDependency[];
  client?: OsvClient;
}): Promise<Array<{ stage: "osv"; message: string }>> {
  const client = input.client ?? new OsvClient();
  const queries = uniqueQueries(input.dependencies);
  let advisories: Map<string, Advisory[]>;
  try {
    advisories = await client.getAdvisories(queries);
  } catch (error) {
    return [{ stage: "osv", message: error instanceof Error ? error.message : String(error) }];
  }

  for (const dependency of input.dependencies) {
    for (const usage of dependency.usages) {
      if (!usage.resolved) continue;
      const found = advisories.get(queryKey({ name: dependency.name, version: usage.resolved }));
      if (!found) continue;
      usage.security = { vulnerable: found.length > 0, advisories: found };
    }
  }
  return [];
}

function uniqueQueries(dependencies: ExternalDependency[]): Query[] {
  const queries = new Map<string, Query>();
  for (const dependency of dependencies) {
    for (const usage of dependency.usages) {
      if (!usage.resolved) continue;
      const query = { name: dependency.name, version: usage.resolved };
      queries.set(queryKey(query), query);
    }
  }
  return [...queries.values()];
}

function normalizeAdvisory(vulnerability: z.infer<typeof VulnerabilitySchema>, packageName: string, packageVersion: string): Advisory {
  const relevantAffected = vulnerability.affected.filter((affected) => affected.package?.name === packageName);
  const segments = relevantAffected.flatMap((affected) =>
    affected.ranges.filter((range) => range.type === "SEMVER").flatMap((range) => eventSegments(range.events)),
  );
  const affectedRange = segments.map((segment) => segment.range).join(" || ") || null;
  const fixedVersion = segments.find((segment) => semver.valid(packageVersion) && semver.satisfies(packageVersion, segment.range))?.fixedVersion ?? null;
  return {
    id: vulnerability.id,
    aliases: vulnerability.aliases,
    url: vulnerability.references.find((reference) => reference.type === "ADVISORY")?.url ?? vulnerability.references[0]?.url ?? null,
    severity: normalizeSeverity(vulnerability.database_specific?.severity),
    affectedRange,
    fixedVersion,
  };
}

function eventSegments(events: Array<Record<string, string>>): Array<{ range: string; fixedVersion: string | null }> {
  const segments: Array<{ range: string; fixedVersion: string | null }> = [];
  let introduced: string | null = null;
  for (const event of events) {
    if (event.introduced) introduced = event.introduced === "0" ? null : event.introduced;
    if (event.fixed || event.last_affected) {
      const upper = event.fixed ? `<${event.fixed}` : `<=${event.last_affected}`;
      segments.push({ range: [introduced ? `>=${introduced}` : null, upper].filter(Boolean).join(" "), fixedVersion: event.fixed ?? null });
      introduced = null;
    }
  }
  if (introduced) segments.push({ range: `>=${introduced}`, fixedVersion: null });
  return segments;
}

function normalizeSeverity(value: string | undefined): Advisory["severity"] {
  const normalized = value?.toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  if (normalized === "moderate") return "medium";
  return "unknown";
}

function queryKey(query: Query): string {
  return `npm:${query.name}:${query.version}`;
}
