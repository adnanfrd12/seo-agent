import { z } from "zod";

export const gscSitesSchema = z.object({
  siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: z.string() })).default([]),
});

export const gscAnalyticsSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).default([]),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number().optional(),
        position: z.number(),
      }),
    )
    .default([]),
});
export type GscRow = z.infer<typeof gscAnalyticsSchema>["rows"][number];
