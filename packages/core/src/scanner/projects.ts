import { acquireGitHubRepository, type AcquiredRepository } from "../acquisition/github.js";
import { loadProjectsConfig, type ConfiguredGitHubProject, type ConfiguredLocalProject } from "../config/projects.js";
import type { ProjectSnapshot } from "../schemas/snapshot.js";
import type { NpmRegistryClient } from "./registry/npm.js";
import type { OsvClient } from "./security/osv.js";
import { scanNodeProject } from "./node.js";

export async function scanConfiguredProjects(input: {
  configPath: string;
  scannedAt?: Date;
  registryClient?: NpmRegistryClient | false;
  osvClient?: OsvClient | false;
  githubToken?: string;
  acquireGitHub?: (project: ConfiguredGitHubProject, token?: string) => Promise<AcquiredRepository>;
}): Promise<ProjectSnapshot[]> {
  const projects = await loadProjectsConfig(input.configPath);
  if (projects.length === 0) throw new Error(`Project config ${input.configPath} has no projects to scan.`);

  const snapshots: ProjectSnapshot[] = [];
  for (const project of projects) {
    const isGitHub = project.source.type === "github";
    const acquired = isGitHub
      ? await (input.acquireGitHub ?? defaultAcquireGitHub)(project as ConfiguredGitHubProject, input.githubToken)
      : { rootPath: (project as ConfiguredLocalProject).rootPath, cleanup: async () => {} };
    try {
      snapshots.push(await scanNodeProject({
        rootPath: acquired.rootPath,
        id: project.id,
        name: project.name,
        repository: isGitHub ? (project as ConfiguredGitHubProject).source.repository : undefined,
        scannedAt: input.scannedAt,
        registryClient: input.registryClient,
        osvClient: input.osvClient,
      }));
    } catch (error) {
      throw new Error(`Project \"${project.id}\" (${acquired.rootPath}) could not be scanned: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await acquired.cleanup();
    }
  }
  return snapshots;
}

function defaultAcquireGitHub(project: ConfiguredGitHubProject, token?: string): Promise<AcquiredRepository> {
  return acquireGitHubRepository({ repositoryUrl: project.source.repository, ref: project.source.ref, token });
}
