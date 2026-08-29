import { describe, expect, it } from "vitest";
import { updateDependency, type PackageManagerCommand, type ProjectSnapshot } from "@4bhiy/watchtower-core";

const snapshot: ProjectSnapshot = {
  id: "fixture",
  name: "Fixture",
  repository: null,
  scan: { status: "success", errors: [] },
  node: { packageManager: "pnpm", monorepo: true },
  workspaces: [
    { id: "fixture", name: "fixture", path: ".", manifestPath: "package.json", version: null },
    { id: "@fixture/web", name: "@fixture/web", path: "apps/web", manifestPath: "apps/web/package.json", version: null },
  ],
  internalDependencies: [],
  dependencies: [{
    name: "zod",
    ecosystem: "npm",
    latest: "4.1.12",
    usages: [{
      workspaceId: "@fixture/web",
      section: "devDependencies",
      declared: "^4.0.0",
      resolved: "4.0.0",
      update: null,
      deprecation: null,
      security: null,
    }],
    versionMismatch: { declared: false, resolved: false },
  }],
  summary: {
    externalDependencyCount: 1,
    externalUsageCount: 1,
    availableUpdateCount: 1,
    majorUpdateCount: 0,
    routineUpdateCount: 1,
    vulnerableUsageCount: 0,
    deprecatedUsageCount: 0,
    declaredVersionMismatchCount: 0,
    resolvedVersionMismatchCount: 0,
  },
};

describe("updateDependency", () => {
  it("targets one workspace and uses the matching package-manager save flag", async () => {
    const commands: PackageManagerCommand[] = [];
    const result = await updateDependency({
      rootPath: "/projects/fixture",
      workspaceId: "@fixture/web",
      packageName: "zod",
      section: "devDependencies",
      version: "4.1.12",
    }, {
      scanner: async () => snapshot,
      runCommand: async (command) => { commands.push(command); },
    });

    expect(commands).toEqual([{
      command: "pnpm",
      arguments: ["add", "zod@4.1.12", "--save-dev"],
      cwd: "/projects/fixture/apps/web",
    }]);
    expect(result.before).toBe(snapshot);
    expect(result.after).toBe(snapshot);
  });

  it("rejects prerelease versions before running a package-manager command", async () => {
    await expect(updateDependency({
      rootPath: "/projects/fixture",
      workspaceId: "@fixture/web",
      packageName: "zod",
      section: "devDependencies",
      version: "5.0.0-beta.1",
    }, {
      scanner: async () => snapshot,
      runCommand: async () => { throw new Error("should not run"); },
    })).rejects.toThrow('Version "5.0.0-beta.1" is not a stable semantic version.');
  });
});
