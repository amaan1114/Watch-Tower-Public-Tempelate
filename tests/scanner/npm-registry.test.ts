import { describe, expect, it } from "vitest";
import { NpmRegistryClient, enrichWithNpmMetadata, type ExternalDependency } from "@4bhiy/watchtower-core";

describe("npm Registry enrichment", () => {
  it("uses the stable latest tag, first newer stable release, and exact-version deprecation", async () => {
    const requested: string[] = [];
    const client = new NpmRegistryClient({
      fetch: async (url) => {
        requested.push(url);
        return new Response(
          JSON.stringify({
            "dist-tags": { latest: "4.1.0", beta: "5.0.0-beta.1" },
            time: {
              "3.24.0": "2026-01-01T00:00:00.000Z",
              "3.25.0": "2026-02-01T00:00:00.000Z",
              "4.0.0-beta.1": "2026-02-02T00:00:00.000Z",
              "4.1.0": "2026-03-01T00:00:00.000Z"
            },
            versions: {
              "3.24.0": { deprecated: "Use a supported release" },
              "3.25.0": {},
              "4.0.0-beta.1": { deprecated: false },
              "4.1.0": {}
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const dependencies: ExternalDependency[] = [
      {
        name: "@scope/example",
        ecosystem: "npm",
        latest: null,
        usages: [
          {
            workspaceId: "web",
            section: "dependencies",
            declared: "^3.24.0",
            resolved: "3.24.0",
            update: null,
            deprecation: null,
            security: null,
          },
        ],
        versionMismatch: { declared: false, resolved: false },
      },
    ];

    const errors = await enrichWithNpmMetadata({
      dependencies,
      client,
      scannedAt: new Date("2026-03-03T00:00:00.000Z"),
    });

    expect(errors).toEqual([]);
    expect(requested).toEqual(["https://registry.npmjs.org/%40scope%2Fexample"]);
    expect(dependencies[0].latest).toBe("4.1.0");
    expect(dependencies[0].usages[0].update).toEqual({
      type: "major",
      firstNewerVersion: "3.25.0",
      behindSince: "2026-02-01T00:00:00.000Z",
      behindDays: 30,
    });
    expect(dependencies[0].usages[0].deprecation).toEqual({
      isDeprecated: true,
      message: "Use a supported release",
    });
  });

  it("returns a stable-only catalogue and falls back when npm latest is a prerelease", async () => {
    const client = new NpmRegistryClient({
      fetch: async () => new Response(
        JSON.stringify({
          "dist-tags": { latest: "5.0.0-beta.1" },
          time: {
            "4.0.0": "2026-01-01T00:00:00.000Z",
            "4.1.0": "2026-02-01T00:00:00.000Z",
            "5.0.0-beta.1": "2026-03-01T00:00:00.000Z",
          },
          versions: {
            "4.0.0": {},
            "4.1.0": { deprecated: "Use 4.2.0" },
            "5.0.0-beta.1": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });

    await expect(client.getStableVersionCatalog("example")).resolves.toEqual({
      packageName: "example",
      latest: "4.1.0",
      versions: [
        { version: "4.1.0", publishedAt: "2026-02-01T00:00:00.000Z", deprecation: "Use 4.2.0" },
        { version: "4.0.0", publishedAt: "2026-01-01T00:00:00.000Z", deprecation: null },
      ],
    });
  });
});
