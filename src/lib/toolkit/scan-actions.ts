"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSiteScan } from "@/lib/toolkit/site-scan";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Owner/admin: re-reads the key pages of the client's own website and refreshes the six site-scan tools (free). */
export async function runSiteScanNow(resetBaseline = false): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run the site scan." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const r = await runSiteScan(db, client.id, target.domain, { resetBaseline });
    for (const s of ["seo-drift", "seo-agentic", "seo-images", "seo-hreflang", "seo-programmatic", "seo-ecommerce"]) revalidatePath(`/toolkit/${s}`);
    return { ok: true, message: `Scanned ${r.pages} pages on ${target.domain} (free): ${r.changes} change${r.changes === 1 ? "" : "s"} since the last scan, ${r.images} images, ${r.services} service pages.` };
  } catch {
    return { ok: false, error: "The website couldn't be scanned. Try again in a few minutes." };
  }
}
