import { NextResponse, type NextRequest } from "next/server";
import { UUID_RE } from "@/lib/org/branding-theme";
import { can, PermissionError, requireOrg } from "@/lib/org/permissions";
import { integrationById } from "@/lib/org/registry";
import { buildGuideInput } from "../_lib/input";
import { renderGuidePdf } from "../_lib/render";

export const runtime = "nodejs";
export const maxDuration = 120;

/** one guide at a time per person on this server instance (each print starts a browser) */
const busy = new Set<string>();

/**
 * Setup guides as PDF: /api/org/guides/all.pdf (every integration) and /api/org/guides/<integration id>.pdf.
 * Owners and admins of the organization only: the active client's organization, or ?org=<id> for another one the
 * person belongs to. Branded with that organization's name and logo; shows whether each integration is set up,
 * never a credential value.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = /^([a-z0-9_]{1,40})\.pdf$/.exec(file)?.[1];
  if (!id || (id !== "all" && !integrationById(id))) return NextResponse.json({ error: "There's no such guide." }, { status: 404 });

  const wanted = request.nextUrl.searchParams.get("org");
  if (wanted && !UUID_RE.test(wanted)) return NextResponse.json({ error: "Unknown organization." }, { status: 400 });
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    // signed out: getSession() redirects to /login
    ctx = await requireOrg(can.manageSettings, wanted ?? undefined, "Only organization owners and admins can download the setup guides.");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  if (busy.has(ctx.userId)) return NextResponse.json({ error: "A guide is already being prepared. Try again in a moment." }, { status: 429 });
  busy.add(ctx.userId);
  try {
    const input = await buildGuideInput(ctx.admin, ctx.orgId, id);
    const { pdf } = await renderGuidePdf(input);
    const slug = (s: string) => s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "organization";
    const name = `${slug(input.brand.orgName)}-${id === "all" ? "integration" : slug(id)}-setup-guide.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error("setup guide pdf failed:", (e instanceof Error ? e.message : String(e)).slice(0, 200));
    return NextResponse.json({ error: "Couldn't generate the PDF. Try again in a minute." }, { status: 500 });
  } finally {
    busy.delete(ctx.userId);
  }
}
