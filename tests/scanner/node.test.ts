import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanNodeProject } from "@4bhiy/watchtower-core";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/pnpm-monorepo");
const npmFixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/npm-project");

describe("scanNodeProject", () => {
  it("discovers declared pnpm workspaces and aggregates external dependency usages", async () => {
    const snapshot = await scanNodeProject({ rootPath: fixturePath, id: "fixture", name: "Fixture", registryClient: false, osvClient: false });

    expect(snapshot.node).toEqual({ packageManager: "pnpm", monorepo: true });
    expect(snapshot.workspaces.map((workspace) => workspace.name)).toEqual([
      "fixture-root",
      "@fixture/web",
      "@fixture/shared",
    ]);
    expect(snapshot.workspaces.map((workspace) => workspace.path)).not.toContain("apps/ignored");
    expect(snapshot.dependencies.map((dependency) => dependency.name)).toEqual(["vitest", "yaml", "zod"]);

    const zod = snapshot.dependencies.find((dependency) => dependency.name === "zod");
    expect(zod?.versionMismatch).toEqual({ declared: true, resolved: true });
    expect(zod?.usages.map((usage) => usage.workspaceId)).toEqual(["@fixture/web", "@fixture/shared"]);
    expect(zod?.usages.map((usage) => usage.resolved)).toEqual(["4.1.12", "3.25.76"]);
    expect(snapshot.internalDependencies).toEqual([
      { fromWorkspaceId: "@fixture/web", toWorkspaceId: "@fixture/shared", declared: "workspace:*" },
    ]);
    expect(snapshot.summary).toEqual({
      externalDependencyCount: 3,
      externalUsageCount: 4,
      availableUpdateCount: 0,
      majorUpdateCount: 0,
      routineUpdateCount: 0,
      vulnerableUsageCount: 0,
      deprecatedUsageCount: 0,
      declaredVersionMismatchCount: 1,
      resolvedVersionMismatchCount: 1,
    });
  });

  it("resolves direct npm dependencies from package-lock.json", async () => {
    const snapshot = await scanNodeProject({ rootPath: npmFixturePath, id: "npm", name: "Npm fixture", registryClient: false, osvClient: false });

    expect(snapshot.node).toEqual({ packageManager: "npm", monorepo: false });
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.dependencies).toMatchObject([
      { name: "express", usages: [{ declared: "^5.0.0", resolved: "5.1.0" }] },
      { name: "yaml", usages: [{ declared: "^2.0.0", resolved: "2.8.1" }] },
    ]);
  });
});
