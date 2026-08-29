import { z } from "zod";
import { ProjectSummarySchema } from "./snapshot.js";

export const HistoryIndexSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.record(
    z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        scannedAt: z.string().datetime(),
        summary: ProjectSummarySchema,
      }),
    ),
  ),
});

export type HistoryIndex = z.infer<typeof HistoryIndexSchema>;
