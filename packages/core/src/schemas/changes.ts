import { z } from "zod";

const DependencyChangeBaseSchema = z.object({
  package: z.string(),
  workspaceId: z.string(),
  section: z.enum(["dependencies", "devDependencies", "optionalDependencies"]),
});

export const ChangeEventSchema = z.discriminatedUnion("type", [
  DependencyChangeBaseSchema.extend({ type: z.literal("dependency-added"), resolved: z.string().nullable() }),
  DependencyChangeBaseSchema.extend({ type: z.literal("dependency-removed"), resolved: z.string().nullable() }),
  DependencyChangeBaseSchema.extend({ type: z.literal("dependency-updated"), from: z.string(), to: z.string() }),
  DependencyChangeBaseSchema.extend({ type: z.literal("dependency-downgraded"), from: z.string(), to: z.string() }),
  z.object({ type: z.literal("new-package-release"), package: z.string(), previousLatest: z.string().nullable(), latest: z.string() }),
  DependencyChangeBaseSchema.extend({ type: z.literal("vulnerability-discovered"), advisoryId: z.string() }),
  DependencyChangeBaseSchema.extend({ type: z.literal("vulnerability-resolved"), advisoryId: z.string() }),
  z.object({
    type: z.literal("version-mismatch-introduced"),
    package: z.string(),
    declared: z.boolean(),
    resolved: z.boolean(),
  }),
  z.object({
    type: z.literal("version-mismatch-resolved"),
    package: z.string(),
    declared: z.boolean(),
    resolved: z.boolean(),
  }),
]);

export const ChangesSchema = z.object({
  schemaVersion: z.literal(1),
  from: z.string().datetime().nullable(),
  to: z.string().datetime(),
  baseline: z.boolean(),
  projects: z.array(z.object({ id: z.string(), events: z.array(ChangeEventSchema) })),
});

export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
export type Changes = z.infer<typeof ChangesSchema>;
