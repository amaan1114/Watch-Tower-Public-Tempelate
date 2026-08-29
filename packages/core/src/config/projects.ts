import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const LocalProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({
    type: z.literal("local"),
    path: z.string().min(1),
  }),
});

const GitHubProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({
    type: z.literal("github"),
    repository: z.string().url().refine((value) => {
      try {
        return new URL(value).hostname === "github.com";
      } catch {
        return false;
      }
    }, "must be a https://github.com/... repository URL"),
    ref: z.string().min(1).optional(),
  }),
});

const ProjectsConfigSchema = z.object({
  projects: z.array(z.union([LocalProjectSchema, GitHubProjectSchema])),
}).superRefine((config, context) => {
  const ids = new Set<string>();
  for (const [index, project] of config.projects.entries()) {
    if (ids.has(project.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projects", index, "id"],
        message: `Project id \"${project.id}\" is duplicated.`,
      });
    }
    ids.add(project.id);
  }
});

export type ConfiguredLocalProject = z.infer<typeof LocalProjectSchema> & { rootPath: string };
export type ConfiguredGitHubProject = z.infer<typeof GitHubProjectSchema>;
export type ConfiguredProject = ConfiguredLocalProject | ConfiguredGitHubProject;

export async function loadProjectsConfig(configPath: string): Promise<ConfiguredProject[]> {
  const resolvedConfigPath = path.resolve(configPath);
  let source: string;
  try {
    source = await readFile(resolvedConfigPath, "utf8");
  } catch (error) {
    throw new Error(`Could not read project config ${resolvedConfigPath}: ${message(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    throw new Error(`Could not parse project config ${resolvedConfigPath}: ${message(error)}`);
  }

  const result = ProjectsConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid project config ${resolvedConfigPath}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }

  const configDirectory = path.dirname(resolvedConfigPath);
  return result.data.projects.map((project): ConfiguredProject => {
    if (project.source.type === "github") return project as ConfiguredGitHubProject;
    return { ...project, rootPath: path.resolve(configDirectory, project.source.path) } as ConfiguredLocalProject;
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
