import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AcquiredRepository = {
  rootPath: string;
  cleanup: () => Promise<void>;
};

export type GitCommandRunner = (arguments_: string[]) => Promise<void>;

export async function acquireGitHubRepository(input: {
  repositoryUrl: string;
  ref?: string;
  token?: string;
}, runGit: GitCommandRunner = runGitCommand): Promise<AcquiredRepository> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "watchtower-"));
  const rootPath = path.join(temporaryDirectory, "repository");
  const cloneArgs = input.token ? ["-c", `http.extraheader=AUTHORIZATION: bearer ${input.token}`] : [];
  cloneArgs.push("clone", "--depth", "1");
  if (input.ref) cloneArgs.push("--branch", input.ref);
  cloneArgs.push(input.repositoryUrl, rootPath);

  try {
    await runGit(cloneArgs);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error(`Could not clone GitHub repository ${input.repositoryUrl}: ${message(error)}`);
  }

  return {
    rootPath,
    cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
  };
}

async function runGitCommand(arguments_: string[]): Promise<void> {
  await execFileAsync("git", arguments_, { maxBuffer: 10 * 1024 * 1024 });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
