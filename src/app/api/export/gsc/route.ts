import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { toCsv } from "@/lib/analytics/csv";
import { createClient } from "@/lib/supabase/server";

const query = z.object({
  kind: z.enum(["keywords", "pages"]),
  start: z.iso.date(),
  end: z.iso.date(),
  sort: z.string().max(40).optional(),
  site: z.uuid().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  device: z.string().max(20).optional(),
  country: z.string().max(10).optional(),
  search: z.string().max(200).optional(),
});

const PAGE = 500;
const MAX_ROWS = 25_000;

/** CSV of the full keyword or page table for the selected range (web search, as on the page). */
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  const q = parsed.data;

  const { client } = await getSession();
  if (!client) return NextResponse.json({ error: "No client" }, { status: 400 });
  // the RPCs only narrow to this site if it is one of the client's tracked resources
  const supabase = await createClient(q.site ? { "x-resource-gsc": q.site } : undefined);

  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  const base = {
    p_client_id: client.id, p_start: q.start, p_end: q.end, p_search: q.search ?? null,
    p_search_type: "web", p_device: q.device ?? null, p_country: q.country ?? null, p_dir: q.dir ?? "desc", p_limit: PAGE,
  };
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } =
      q.kind === "keywords"
        ? await supabase.rpc("get_gsc_keywords", { ...base, p_sort: q.sort ?? "clicks", p_offset: offset })
        : await supabase.rpc("get_gsc_top_pages", { ...base, p_sort: q.sort ?? "clicks", p_offset: offset });
    if (error) return NextResponse.json({ error: "Export failed" }, { status: error.code === "22023" ? 400 : 500 });
    const page = ((data as { rows?: Row[] } | null)?.rows ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const csv =
    q.kind === "keywords"
      ? toCsv(
          ["Search query", "Clicks", "Impressions", "CTR", "Average position", "Position change"],
          rows.map((r) => [r.query, r.clicks, r.impressions, r.ctr, r.position, r.position_change]),
        )
      : toCsv(
          ["Page URL", "Clicks", "Impressions", "CTR", "Average position"],
          rows.map((r) => [r.page, r.clicks, r.impressions, r.ctr, r.position]),
        );

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gsc-${q.kind}-${q.start}_${q.end}.csv"`,
      "cache-control": "no-store",
    },
  });
}
