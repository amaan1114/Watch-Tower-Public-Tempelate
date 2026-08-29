import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanConfiguredProjects } from "@4bhiy/watchtower-core";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/projects.yml");
const monorepoFixturePath = path.join(path.dirname(fixturePath), "pnpm-monorepo");

describe("scanConfiguredProjects", () => {
  it("loads YAML projects, resolves paths relative to the config, and scans each one", async () => {
    const cloned: string[] = [];
    const projects = await scanConfiguredProjects({
      configPath: fixturePath,
      registryClient: false,
      osvClient: false,
      acquireGitHub: async (project) => {
        cloned.push(`${project.source.repository}@${project.source.ref}`);
        return { rootPath: monorepoFixturePath, cleanup: async () => {} };
      },
    });

    expect(projects.map((project) => project.id)).toEqual(["fixture-monorepo", "fixture-npm", "fixture-github"]);
    expect(projects.map((project) => project.node?.packageManager)).toEqual(["pnpm", "npm", "pnpm"]);
    expect(cloned).toEqual(["https://github.com/example/fixture.git@main"]);
    expect(projects[2].repository).toBe("https://github.com/example/fixture.git");
  });

  it("names the YAML project when its source cannot be scanned", async () => {
    const invalidConfigPath = path.join(path.dirname(fixturePath), "projects-invalid.yml");
    await expect(scanConfiguredProjects({ configPath: invalidConfigPath, registryClient: false, osvClient: false }))
      .rejects.toThrow('Project "missing-repository"');
  });
});
