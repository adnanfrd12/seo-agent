"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { aiErrorMessage } from "@/lib/ai/claude";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError } from "@/lib/dataforseo/client";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultBriefKeyword, runBrief } from "@/lib/toolkit/brief";
import { runCluster } from "@/lib/toolkit/cluster";
import { runComparison } from "@/lib/toolkit/comparison";
import { runContent } from "@/lib/toolkit/content";
import { analyzePage } from "@/lib/toolkit/page";
import { ownUrl, saveTool } from "@/lib/toolkit/store";
import { runSxo } from "@/lib/toolkit/sxo";

type Result = { ok: true; message: string } | { ok: false; error: string };
export type ToolSlug = "seo-page" | "seo-content" | "seo-content-brief" | "seo-cluster" | "seo-sxo" | "seo-competitor-pages";

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 3)}`;

/** Runs one SEO Toolkit tool on demand (owners and admins) and stores its result as the tool's single dfs_cache row. */
export async function runToolkit(slug: ToolSlug, input: string): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run toolkit tools." };
  const admin = createAdminClient();
  const target = await resolveTarget(admin, client.id);
  if (!target) return { ok: false, error: "Set the client's website first." };
  const value = (input ?? "").slice(0, 300).trim();
  try {
    let message: string;
    switch (slug) {
      case "seo-page": {
        const url = ownUrl(value, target.domain);
        if (!url) return { ok: false, error: `Enter a page on ${target.domain}.` };
        const r = await analyzePage(admin, client.id, url, target.domain);
        await saveTool(admin, client.id, slug, r, 0, { url });
        message = `Analyzed ${r.finalUrl}: score ${r.score}/100, ${r.fixes.length} fixes (free).`;
        break;
      }
      case "seo-content": {
        const url = value ? ownUrl(value, target.domain) : null;
        if (value && !url) return { ok: false, error: `Enter a page on ${target.domain}, or leave empty for the top 10 blog posts.` };
        const r = await runContent(admin, client.id, url);
        await saveTool(admin, client.id, slug, r, r.cost, { url });
        message = `Reviewed ${r.pages.length} page${r.pages.length === 1 ? "" : "s"} (AI cost ${usd(r.cost)}).`;
        break;
      }
      case "seo-content-brief": {
        const kw = value.toLowerCase() || (await defaultBriefKeyword(admin, client.id));
        if (!kw) return { ok: false, error: "Enter a keyword." };
        const r = await runBrief(admin, client.id, kw, target);
        await saveTool(admin, client.id, slug, r, r.cost.serp + r.cost.ai, { keyword: kw });
        message = `Brief for "${kw}" ready (SERP ${usd(r.cost.serp)} + AI ${usd(r.cost.ai)}).`;
        break;
      }
      case "seo-cluster": {
        const r = await runCluster(admin, client.id, target);
        await saveTool(admin, client.id, slug, r, r.cost);
        message = `${r.clusters.length} clusters from ${r.totalKeywords} keywords; ${r.searched} searches (${usd(r.cost)}), ${r.reused} reused.`;
        break;
      }
      case "seo-sxo": {
        const r = await runSxo(admin, client.id, target);
        await saveTool(admin, client.id, slug, r, r.cost);
        message = `${r.rows.length} keywords checked, ${r.rows.filter((x) => x.mismatch).length} mismatches (${usd(r.cost)}).`;
        break;
      }
      case "seo-competitor-pages": {
        const r = await runComparison(admin, client.id, target, client.name);
        await saveTool(admin, client.id, slug, r, r.cost);
        message = `${r.pages.length} page outlines drafted (AI cost ${usd(r.cost)}).`;
        break;
      }
      default:
        return { ok: false, error: "Unknown tool." };
    }
    revalidatePath(`/toolkit/${slug}`);
    revalidatePath("/toolkit");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof BudgetError || e instanceof DfsError) return { ok: false, error: e.message };
    return { ok: false, error: aiErrorMessage(e) };
  }
}
