import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import * as semver from "semver";
import type { DependencySection, ProjectSnapshot } from "../schemas/snapshot.js";
import { scanNodeProject } from "../scanner/node.js";

const execFileAsync = promisify(execFile);

export type PackageManagerCommand = {
  command: "pnpm" | "npm";
  arguments: string[];
  cwd: string;
};

export type DependencyUpdateRequest = {
  rootPath: string;
  workspaceId: string;
  packageName: string;
  section: DependencySection;
  version: string;
  projectId?: string;
  projectName?: string;
};

export type DependencyUpdateResult = {
  command: PackageManagerCommand;
  before: ProjectSnapshot;
  after: ProjectSnapshot;
};

type ProjectScanner = (input: Parameters<typeof scanNodeProject>[0]) => Promise<ProjectSnapshot>;
type CommandRunner = (command: PackageManagerCommand) => Promise<void>;

/**
 * Updates one external dependency in one explicit workspace, then rescans the project.
 * Callers must obtain user confirmation before invoking this function.
 */
export async function updateDependency(
  request: DependencyUpdateRequest,
  options: { scanner?: ProjectScanner; runCommand?: CommandRunner } = {},
): Promise<DependencyUpdateResult> {
  assertStableVersion(request.version);
  const rootPath = path.resolve(request.rootPath);
  const scan = options.scanner ?? scanNodeProject;
  const scanInput = {
    rootPath,
    id: request.projectId ?? path.basename(rootPath),
    name: request.projectName ?? path.basename(rootPath),
  };
  const before = await scan(scanInput);
  const packageManager = before.node?.packageManager;
  if (!packageManager) throw new Error("Only Node.js projects with a supported package manager can be updated.");

  const workspace = before.workspaces.find((candidate) => candidate.id === request.workspaceId);
  if (!workspace) throw new Error(`Workspace "${request.workspaceId}" was not found in the current scan.`);
  const dependency = before.dependencies.find((candidate) => candidate.name === request.packageName);
  const usage = dependency?.usages.find((candidate) => candidate.workspaceId === request.workspaceId && candidate.section === request.section);
  if (!usage) {
    throw new Error(`Dependency "${request.packageName}" is not declared in ${workspace.manifestPath} under ${request.section}.`);
  }

  const cwd = workspaceDirectory(rootPath, workspace.path);
  const command = packageManagerCommand({ packageManager, cwd, packageName: request.packageName, version: request.version, section: request.section });
  try {
    await (options.runCommand ?? runPackageManagerCommand)(command);
  } catch (error) {
    throw new Error(`Could not update ${request.packageName} in ${workspace.manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const after = await scan({ ...scanInput, repository: before.repository ?? undefined });
  return { command, before, after };
}

export function packageManagerCommand(input: {
  packageManager: "pnpm" | "npm";
  cwd: string;
  packageName: string;
  version: string;
  section: DependencySection;
}): PackageManagerCommand {
  const specification = `${input.packageName}@${input.version}`;
  const saveFlag = input.section === "devDependencies"
    ? "--save-dev"
    : input.section === "optionalDependencies"
      ? "--save-optional"
      : null;
  return {
    command: input.packageManager,
    arguments: [input.packageManager === "pnpm" ? "add" : "install", specification, ...(saveFlag ? [saveFlag] : [])],
    cwd: input.cwd,
  };
}

function assertStableVersion(version: string): void {
  const parsed = semver.parse(version);
  if (!parsed || parsed.prerelease.length > 0) {
    throw new Error(`Version "${version}" is not a stable semantic version.`);
  }
}

function workspaceDirectory(rootPath: string, workspacePath: string): string {
  const directory = path.resolve(rootPath, workspacePath);
  const relative = path.relative(rootPath, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Workspace path "${workspacePath}" is outside the project root.`);
  return directory;
}

async function runPackageManagerCommand(command: PackageManagerCommand): Promise<void> {
  await execFileAsync(command.command, command.arguments, { cwd: command.cwd });
}
