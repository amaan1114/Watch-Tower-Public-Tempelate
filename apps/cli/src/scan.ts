import path from "node:path";
import { SnapshotSchema, scanConfiguredProjects, scanNodeProject } from "@4bhiy/watchtower-core";
import { persistScan } from "@watchtower/history";

type Arguments =
  | { kind: "source"; source: string; id: string; name: string; output: string }
  | { kind: "config"; config: string; output: string };

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const scannedAt = new Date();
  const projects = args.kind === "config"
    ? await scanConfiguredProjects({ configPath: args.config, scannedAt, githubToken: process.env.WATCHTOWER_GITHUB_TOKEN })
    : [await scanNodeProject({ rootPath: args.source, id: args.id, name: args.name, scannedAt })];
  const snapshot = SnapshotSchema.parse({ schemaVersion: 1, scannedAt: scannedAt.toISOString(), projects });
  const outputPath = path.resolve(args.output);
  const changes = await persistScan({ currentPath: outputPath, snapshot });
  for (const project of projects) {
    console.log(`Scanned ${project.name}: ${project.workspaces.length} workspace(s), ${project.summary.externalDependencyCount} external dependency/dependencies.`);
  }
  console.log(`Wrote ${outputPath}`);
  console.log(changes.baseline ? "Created baseline history snapshot." : `Recorded ${changes.projects.reduce((count, projectChanges) => count + projectChanges.events.length, 0)} change event(s).`);
}

function parseArguments(argv: string[]): Arguments {
  // pnpm forwards a leading `--` to package scripts when invoked as
  // `pnpm scan -- --source …`; accept that conventional CLI form.
  if (argv[0] === "--") argv = argv.slice(1);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) usage();
    values.set(flag.slice(2), value);
  }
  const source = values.get("source");
  const config = values.get("config");
  if (Boolean(source) === Boolean(config)) usage();
  const output = values.get("output") ?? path.join(workspaceRoot(), "data/current.json");
  if (config) return { kind: "config", config, output };
  if (!source) usage();
  return {
    kind: "source",
    source,
    id: values.get("id") ?? path.basename(path.resolve(source)).toLowerCase(),
    name: values.get("name") ?? path.basename(path.resolve(source)),
    output,
  };
}

function workspaceRoot(): string {
  return path.resolve(process.env.WATCHTOWER_WORKSPACE_ROOT ?? process.cwd());
}

function usage(): never {
  throw new Error("Usage: pnpm scan -- (--source <repository-path> [--id <project-id>] [--name <display-name>] | --config <projects.yml>) [--output <file>]");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
