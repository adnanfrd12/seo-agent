import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { toCsv } from "@/lib/analytics/csv";
import { createClient } from "@/lib/supabase/server";

const query = z.object({
  kind: z.enum(["sources", "pages"]),
  start: z.iso.date(),
  end: z.iso.date(),
  sort: z.string().max(40).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  group: z.enum(["source_medium", "channel"]).optional(),
  pages: z.enum(["views", "landing"]).optional(),
});

const PAGE = 500;
const MAX_ROWS = 25_000;

/** CSV of the full (unpaginated) table for the selected range, through the same authorized RPCs. */
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  const q = parsed.data;

  const { client } = await getSession();
  if (!client) return NextResponse.json({ error: "No client" }, { status: 400 });
  const supabase = await createClient();

  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } =
      q.kind === "sources"
        ? await supabase.rpc("get_ga4_traffic_sources", {
            p_client_id: client.id, p_start: q.start, p_end: q.end, p_group_by: q.group ?? "source_medium",
            p_sort: q.sort ?? "sessions", p_dir: q.dir ?? "desc", p_limit: PAGE, p_offset: offset,
          })
        : await supabase.rpc("get_ga4_top_pages", {
            p_client_id: client.id, p_start: q.start, p_end: q.end, p_kind: q.pages ?? "views",
            p_sort: q.sort ?? "views", p_dir: q.dir ?? "desc", p_limit: PAGE, p_offset: offset,
          });
    if (error) return NextResponse.json({ error: "Export failed" }, { status: error.code === "22023" ? 400 : 500 });
    const page = ((data as { rows?: Row[] } | null)?.rows ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const csv =
    q.kind === "sources"
      ? toCsv(
          ["Source", "Medium", "Sessions", "Users", "Engagement rate", "Key events"],
          rows.map((r) => [r.source, r.medium, r.sessions, r.users, r.engagement_rate, r.key_events]),
        )
      : toCsv(
          ["Page path", "Views", "Active users", "Sessions", "Avg engagement seconds", "Key events"],
          rows.map((r) => [r.page_path, r.views, r.users, r.sessions, r.avg_engagement_seconds, r.key_events]),
        );

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ga4-${q.kind}-${q.start}_${q.end}.csv"`,
      "cache-control": "no-store",
    },
  });
}
