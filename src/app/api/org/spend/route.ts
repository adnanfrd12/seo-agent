import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { toCsv } from "@/lib/analytics/csv";
import { can, PermissionError, requireOrg } from "@/lib/org/permissions";
import { aiSpendReport, SpendError, spendRecords, toolsSpendReport, type SpendRange } from "@/lib/org/spend";

export const dynamic = "force-dynamic";

const query = z.object({
  org: z.uuid(),
  kind: z.enum(["ai", "tools"]),
  range: z.enum(["7d", "30d", "90d", "12m"] satisfies SpendRange[]).default("30d"),
  format: z.enum(["json", "csv"]).default("json"),
});
const NO_STORE = { "cache-control": "private, no-store" };

/**
 * GET ?org=&kind=ai|tools&range=7d|30d|90d|12m — an organization's spend report (JSON) for the AI spend and All tools
 * spend tabs, or with &format=csv every record of the range. Owners and admins of that organization only.
 */
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid parameters." }, { status: 400, headers: NO_STORE });
  const { org, kind, range, format } = parsed.data;

  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg(can.manageSettings, org, "Only owners and admins of this organization can see what it spends.");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403, headers: NO_STORE });
    throw e; // e.g. the redirect to sign in
  }

  try {
    if (format === "csv") {
      const { filename, headers, rows } = await spendRecords(ctx.admin, ctx.orgId, kind, range);
      return new NextResponse(toCsv(headers, rows), {
        headers: { ...NO_STORE, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "-")}"` },
      });
    }
    const report = kind === "ai" ? await aiSpendReport(ctx.admin, ctx.orgId, range) : await toolsSpendReport(ctx.admin, ctx.orgId, range);
    return NextResponse.json(report, { headers: NO_STORE });
  } catch (e) {
    if (!(e instanceof SpendError)) console.error("org spend report failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof SpendError ? e.message : "Couldn't load spend. Try again in a moment." }, { status: 500, headers: NO_STORE });
  }
}
