import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { type Snapshot } from "@4bhiy/watchtower-core";
import { persistScan } from "@watchtower/history";

describe("daily snapshot persistence", () => {
  it("creates a baseline, archives snapshots, updates the history index, and records factual change events", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "watchtower-history-"));
    try {
      const currentPath = path.join(directory, "current.json");
      const baseline = snapshot("2026-08-26T02:30:00.000Z", "3.24.0", "4.0.0", ["GHSA-old"], false);
      const firstChanges = await persistScan({ currentPath, snapshot: baseline });
      expect(firstChanges.baseline).toBe(true);

      const next = snapshot("2026-08-27T02:30:00.000Z", "4.0.0", "4.1.0", ["GHSA-new"], true);
      const changes = await persistScan({ currentPath, snapshot: next });
      expect(changes).toMatchObject({ baseline: false, from: baseline.scannedAt, to: next.scannedAt });
      expect(changes.projects[0].events.map((event) => event.type)).toEqual([
        "dependency-updated",
        "vulnerability-discovered",
        "vulnerability-resolved",
        "new-package-release",
        "version-mismatch-introduced",
      ]);

      const history = JSON.parse(await readFile(path.join(directory, "history/2026/08/2026-08-27.json"), "utf8"));
      expect(history.scannedAt).toBe(next.scannedAt);
      const index = JSON.parse(await readFile(path.join(directory, "history-index.json"), "utf8"));
      expect(index.projects.blueprint.map((entry: { date: string }) => entry.date)).toEqual(["2026-08-26", "2026-08-27"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function snapshot(scannedAt: string, resolved: string, latest: string, advisoryIds: string[], mismatch: boolean): Snapshot {
  return {
    schemaVersion: 1,
    scannedAt,
    projects: [
      {
        id: "blueprint",
        name: "Blueprint",
        repository: null,
        scan: { status: "success", errors: [] },
        node: { packageManager: "pnpm", monorepo: true },
        workspaces: [{ id: "web", name: "web", path: "apps/web", manifestPath: "apps/web/package.json", version: "1.0.0" }],
        internalDependencies: [],
        dependencies: [
          {
            name: "zod",
            ecosystem: "npm",
            latest,
            usages: [
              {
                workspaceId: "web",
                section: "dependencies",
                declared: `^${resolved}`,
                resolved,
                update: null,
                deprecation: { isDeprecated: false, message: null },
                security: {
                  vulnerable: advisoryIds.length > 0,
                  advisories: advisoryIds.map((id) => ({
                    id,
                    aliases: [],
                    url: null,
                    severity: "high" as const,
                    affectedRange: null,
                    fixedVersion: null,
                  })),
                },
              },
            ],
            versionMismatch: { declared: mismatch, resolved: mismatch },
          },
        ],
        summary: {
          externalDependencyCount: 1,
          externalUsageCount: 1,
          availableUpdateCount: 0,
          majorUpdateCount: 0,
          routineUpdateCount: 0,
          vulnerableUsageCount: advisoryIds.length > 0 ? 1 : 0,
          deprecatedUsageCount: 0,
          declaredVersionMismatchCount: mismatch ? 1 : 0,
          resolvedVersionMismatchCount: mismatch ? 1 : 0,
        },
      },
    ],
  };
}
