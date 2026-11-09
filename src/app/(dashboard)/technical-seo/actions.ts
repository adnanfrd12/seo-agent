"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTechnicalChecks } from "@/lib/technical/checks";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Reads robots.txt, the sitemaps and up to 25 pages from the client's own website. Free; owners and admins only. */
export async function runTechnicalChecksNow(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run the technical checks." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const r = await runTechnicalChecks(db, client.id, target.domain);
    revalidatePath("/technical-seo");
    return { ok: true, message: `Checked robots.txt, ${r.sitemaps.length} sitemap file${r.sitemaps.length === 1 ? "" : "s"} and ${r.pages.length} pages on ${r.domain} (free).` };
  } catch {
    return { ok: false, error: "The website couldn't be checked. Try again in a few minutes." };
  }
}
