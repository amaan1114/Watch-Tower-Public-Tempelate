import { describe, expect, it } from "vitest";
import { type Changes, type ExternalDependency, type Snapshot } from "@4bhiy/watchtower-core";
import { formatTelegramReport } from "@watchtower/telegram";

describe("formatTelegramReport", () => {
  it("summarizes changes and current actionable dependency facts", () => {
    const snapshot = {
      schemaVersion: 1,
      scannedAt: "2026-08-26T02:30:00.000Z",
      projects: [{
        id: "blueprint",
        name: "Blueprint",
        repository: "https://github.com/example/blueprint.git",
        scan: { status: "success", errors: [] },
        node: { packageManager: "pnpm", monorepo: true },
        workspaces: [
          { id: "root", name: "root", path: ".", manifestPath: "package.json", version: "1.0.0" },
          { id: "web", name: "web", path: "apps/web", manifestPath: "apps/web/package.json", version: "1.0.0" },
        ],
        internalDependencies: [],
        dependencies: [
          dependency("next", "16.2.10", "16.3.0", "major", "web", true, false, "16.2.11"),
          dependency("vite", "7.1.0", "7.1.1", "patch", "web"),
          dependency("legacy", "1.0.0", null, null, "root", false, true),
        ],
        summary: emptySummary(),
      }],
    } as Snapshot;
    const changes = {
      schemaVersion: 1,
      from: "2026-08-25T02:30:00.000Z",
      to: snapshot.scannedAt,
      baseline: false,
      projects: [{ id: "blueprint", events: [{ type: "new-package-release", package: "next", previousLatest: "16.2.11", latest: "16.3.0" }] }],
    } as Changes;

    const report = formatTelegramReport({ snapshot, changes, dashboardUrl: "https://example.github.io/Watch-Tower/" });

    expect(report).toContain("🧭 <b>Changes</b> · 1");
    expect(report).toContain("next released 16.3.0");
    expect(report).toContain("🚨 <b>SECURITY ISSUES</b> · 1");
    expect(report).toContain("<b>next</b> <code>16.2.10</code> → <code>16.2.11</code> <i>· web</i>");
    expect(report).toContain("⬆️ <b>MAJOR UPDATES</b> · 1");
    expect(report).toContain("✨ <b>ROUTINE UPDATES</b> · 1");
    expect(report).toContain("⚠️ <b>DEPRECATED PACKAGES</b> · 1");
    expect(report).toContain("Open dashboard");

    const overflowing = structuredClone(snapshot);
    for (let index = 0; index < 5; index += 1) {
      overflowing.projects[0].dependencies.push(dependency(`major-${index}`, "1.0.0", "2.0.0", "major", "web"));
    }
    const overflowingReport = formatTelegramReport({ snapshot: overflowing, changes });
    expect(overflowingReport).toContain("⬆️ <b>MAJOR UPDATES</b> · 6");
    expect(overflowingReport).toContain("<i>+1 more in dashboard</i>");
  });
});

function dependency(
  name: string,
  resolved: string,
  latest: string | null,
  updateType: "major" | "minor" | "patch" | null,
  workspaceId: string,
  vulnerable = false,
  deprecated = false,
  fixedVersion: string | null = null,
): ExternalDependency {
  return {
    name,
    ecosystem: "npm" as const,
    latest,
    versionMismatch: { declared: false, resolved: false },
    usages: [{
      workspaceId,
      section: "dependencies" as const,
      declared: `^${resolved}`,
      resolved,
      update: updateType ? { type: updateType, firstNewerVersion: latest ?? resolved, behindSince: null, behindDays: null } : null,
      deprecation: { isDeprecated: deprecated, message: null },
      security: vulnerable ? {
        vulnerable: true,
        advisories: [{ id: "GHSA-test", aliases: [], url: null, severity: "high" as const, affectedRange: null, fixedVersion }],
      } : { vulnerable: false, advisories: [] },
    }],
  };
}

function emptySummary() {
  return {
    externalDependencyCount: 0,
    externalUsageCount: 0,
    availableUpdateCount: 0,
    majorUpdateCount: 0,
    routineUpdateCount: 0,
    vulnerableUsageCount: 0,
    deprecatedUsageCount: 0,
    declaredVersionMismatchCount: 0,
    resolvedVersionMismatchCount: 0,
  };
}
