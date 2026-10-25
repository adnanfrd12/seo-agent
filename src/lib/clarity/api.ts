import "server-only";
import { z } from "zod";

/**
 * Microsoft Clarity Data Export API (official):
 *   GET https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1..3&dimension1=...
 *   Authorization: Bearer <project API token>
 * Limits: 10 requests per project per day, last 1-3 days only, max 1,000 rows, no pagination,
 * results in UTC. There is NO API for session recordings.
 */
const ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export class ClarityError extends Error {
  constructor(message: string, public kind: "auth" | "rate_limit" | "bad_request" | "other") { super(message); }
}

const responseSchema = z.array(z.object({
  metricName: z.string(),
  information: z.array(z.record(z.string(), z.unknown())).default([]),
}));
export type ClarityResponse = z.infer<typeof responseSchema>;

export type ClarityDimension = "URL" | "Device" | "Browser";

export async function clarityInsights(token: string, dimension?: ClarityDimension): Promise<ClarityResponse> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("numOfDays", "1");
  if (dimension) url.searchParams.set("dimension1", dimension);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new ClarityError("Clarity rejected the API token. Generate a new one in Clarity → Settings → Data Export.", "auth");
  if (res.status === 429) throw new ClarityError("Clarity's daily limit of 10 API requests was reached. It resets tomorrow.", "rate_limit");
  if (res.status === 400) throw new ClarityError("Clarity rejected the request parameters.", "bad_request");
  if (!res.ok) throw new ClarityError(`Clarity API error ${res.status}.`, "other");
  return responseSchema.parse(await res.json());
}

const asNum = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Field holding the dimension value in an information row (key casing varies by dimension). */
function dimValue(info: Record<string, unknown>, dimension?: ClarityDimension): string {
  // without a dimension, list metrics (PopularPages, Browser, OS, Country, ReferrerUrl...) carry their own label
  if (!dimension) return String(info.url ?? info.name ?? info.title ?? info.Url ?? info.Name ?? "");
  const key = Object.keys(info).find((k) => k.toLowerCase() === dimension.toLowerCase());
  return key ? String(info[key] ?? "") : "";
}

export interface ClarityRow { dimension: "total" | "url" | "device" | "browser"; value: string; metric: string; count: number | null; sessions_pct: number | null; sessions: number | null; raw: Record<string, unknown> }

/**
 * Flattens a response into one row per (dimension value, metric). Count fields differ by metric
 * (e.g. subTotal for click metrics, totalSessionCount for Traffic); raw keeps everything.
 */
export function flatten(resp: ClarityResponse, dimension?: ClarityDimension): ClarityRow[] {
  const dim = (dimension ? dimension.toLowerCase() : "total") as ClarityRow["dimension"];
  return resp.flatMap((m) => m.information.map((info) => ({
    dimension: dim,
    value: dimValue(info, dimension).slice(0, 2000),
    metric: m.metricName,
    count: asNum(info.subTotal ?? info.totalSessionCount ?? info.averageScrollDepth ?? info.totalTime ?? info.activeTime ?? info.visitsCount ?? info.sessionsCount),
    sessions_pct: asNum(info.sessionsWithMetricPercentage),
    sessions: asNum(info.sessionsCount ?? info.totalSessionCount),
    raw: info,
  })));
}
