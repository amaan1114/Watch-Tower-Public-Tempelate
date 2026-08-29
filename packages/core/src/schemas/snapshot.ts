import { z } from "zod";

export const DependencySectionSchema = z.enum([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
]);

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  path: z.string(),
  manifestPath: z.string(),
  version: z.string().nullable(),
});

export const DependencyUsageSchema = z.object({
  workspaceId: z.string(),
  section: DependencySectionSchema,
  declared: z.string(),
  resolved: z.string().nullable(),
  update: z
    .object({
      type: z.enum(["major", "minor", "patch"]),
      firstNewerVersion: z.string(),
      behindSince: z.string().datetime().nullable(),
      behindDays: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  deprecation: z
    .object({
      isDeprecated: z.boolean(),
      message: z.string().nullable(),
    })
    .nullable(),
  security: z
    .object({
      vulnerable: z.boolean(),
      advisories: z.array(
        z.object({
          id: z.string(),
          aliases: z.array(z.string()),
          url: z.string().url().nullable(),
          severity: z.enum(["critical", "high", "medium", "low", "unknown"]),
          affectedRange: z.string().nullable(),
          fixedVersion: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});

export const ExternalDependencySchema = z.object({
  name: z.string(),
  ecosystem: z.literal("npm"),
  latest: z.string().nullable(),
  usages: z.array(DependencyUsageSchema),
  versionMismatch: z.object({
    declared: z.boolean(),
    resolved: z.boolean(),
  }),
});

export const ProjectSummarySchema = z.object({
  externalDependencyCount: z.number().int().nonnegative(),
  externalUsageCount: z.number().int().nonnegative(),
  availableUpdateCount: z.number().int().nonnegative(),
  majorUpdateCount: z.number().int().nonnegative(),
  routineUpdateCount: z.number().int().nonnegative(),
  vulnerableUsageCount: z.number().int().nonnegative(),
  deprecatedUsageCount: z.number().int().nonnegative(),
  declaredVersionMismatchCount: z.number().int().nonnegative(),
  resolvedVersionMismatchCount: z.number().int().nonnegative(),
});

export const ProjectSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  repository: z.string().nullable(),
  scan: z.object({
    status: z.enum(["success", "partial", "failed"]),
    errors: z.array(z.object({ stage: z.string(), message: z.string() })),
  }),
  node: z
    .object({
      packageManager: z.enum(["pnpm", "npm"]),
      monorepo: z.boolean(),
    })
    .nullable(),
  workspaces: z.array(WorkspaceSchema),
  internalDependencies: z.array(
    z.object({ fromWorkspaceId: z.string(), toWorkspaceId: z.string(), declared: z.string() }),
  ),
  dependencies: z.array(ExternalDependencySchema),
  summary: ProjectSummarySchema,
});

export const SnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  scannedAt: z.string().datetime(),
  projects: z.array(ProjectSnapshotSchema),
});

export type DependencySection = z.infer<typeof DependencySectionSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type DependencyUsage = z.infer<typeof DependencyUsageSchema>;
export type ExternalDependency = z.infer<typeof ExternalDependencySchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
