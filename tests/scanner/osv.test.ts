import { describe, expect, it } from "vitest";
import { OsvClient, enrichWithOsv, type ExternalDependency } from "@4bhiy/watchtower-core";

describe("OSV enrichment", () => {
  it("batches unique resolved versions and maps normalized advisories to every usage", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new OsvClient({
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (url.endsWith("/querybatch")) {
          return jsonResponse({ results: [{ vulns: [{ id: "GHSA-test-1234" }] }, { vulns: [] }] });
        }
        return jsonResponse({
          id: "GHSA-test-1234",
          aliases: ["CVE-2026-0001"],
          database_specific: { severity: "HIGH" },
          references: [{ type: "ADVISORY", url: "https://example.test/advisories/1234" }],
          affected: [
            {
              package: { name: "zod" },
              ranges: [
                {
                  type: "SEMVER",
                  events: [
                    { introduced: "3.0.0" },
                    { fixed: "3.25.0" },
                    { introduced: "4.0.0" },
                    { fixed: "4.2.0" },
                  ],
                },
              ],
            },
          ],
        });
      },
    });
    const dependencies: ExternalDependency[] = [
      dependency("zod", ["4.1.0", "4.1.0"]),
      dependency("yaml", ["2.8.0"]),
    ];

    const errors = await enrichWithOsv({ dependencies, client });

    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      queries: [
        { package: { ecosystem: "npm", name: "zod" }, version: "4.1.0" },
        { package: { ecosystem: "npm", name: "yaml" }, version: "2.8.0" },
      ],
    });
    expect(dependencies[0].usages.map((usage) => usage.security)).toEqual([
      {
        vulnerable: true,
        advisories: [
          {
            id: "GHSA-test-1234",
            aliases: ["CVE-2026-0001"],
            url: "https://example.test/advisories/1234",
            severity: "high",
            affectedRange: ">=3.0.0 <3.25.0 || >=4.0.0 <4.2.0",
            fixedVersion: "4.2.0",
          },
        ],
      },
      expect.any(Object),
    ]);
    expect(dependencies[1].usages[0].security).toEqual({ vulnerable: false, advisories: [] });
  });
});

function dependency(name: string, versions: string[]): ExternalDependency {
  return {
    name,
    ecosystem: "npm",
    latest: null,
    usages: versions.map((resolved, index) => ({
      workspaceId: `${name}-${index}`,
      section: "dependencies" as const,
      declared: `^${resolved}`,
      resolved,
      update: null,
      deprecation: null,
      security: null,
    })),
    versionMismatch: { declared: false, resolved: false },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
