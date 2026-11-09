import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic } from "@/lib/ai/claude";
import { fetchHtml, htmlAttr } from "./store";

/**
 * Comparison-page planner: "<Brand> vs <Competitor>" and "<Competitor> alternatives" outlines built from stored competitor
 * data (competitors, kw_shared, kw_gap, comp_pages, domain_overview; no paid DataForSEO call) and drafted by Claude Haiku 5.5
 * (~$0.002). Page structure (fair comparison table, who-each-is-for, verifiable claims only) adapted from the
 * seo-competitor-pages skill of the MIT-licensed claude-seo project (https://github.com/AgricIDaniel/claude-seo).
 */
export const COMP_MODEL = "claude-haiku-5-5";
const PRICE = { input: 0.1, output: 0.5 };

const outline = z.object({
  kind: z.enum(["vs", "alternatives"]), competitor: z.string(), title_tag: z.string(), h1: z.string(), slug: z.string(), target_keyword: z.string(),
  sections: z.array(z.object({ heading: z.string(), notes: z.string() })),
  comparison_rows: z.array(z.string()), proof_needed: z.array(z.string()), cta: z.string(),
});
const schema = z.object({ pages: z.array(outline) });
export type CompOutline = z.infer<typeof outline>;
export interface CompStat { domain: string; shared: number | null; keywords: number | null; traffic: number | null; avgPosition: number | null; sharedKws: string[]; gapKws: string[]; topPages: string[] }
export interface CompRun { brand: string; stats: CompStat[]; pages: CompOutline[]; cost: number }

type Row = Record<string, unknown>;

/** The brand as the website names itself (og:site_name / application-name), else the client's name in the dashboard. */
async function siteBrand(domain: string, fallback: string): Promise<string> {
  const r = await fetchHtml(`https://${domain}/`);
  const tag = [...r.html.slice(0, 200_000).matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /(og:site_name|application-name)/i.test(t));
  const name = tag ? htmlAttr(tag, "content")?.trim() : null;
  return name && name.length < 60 ? name : fallback;
}

export async function runComparison(admin: SupabaseClient, clientId: string, target: { domain: string; competitors: string[] }, clientName: string): Promise<CompRun> {
  // the website can be slow: when it doesn't answer, keep the brand found on the previous run
  const prev = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "tk_seo-competitor-pages").maybeSingle();
  const brand = await siteBrand(target.domain, (prev.data?.data as { brand?: string } | null)?.brand ?? clientName);
  const { data } = await admin.from("dfs_cache").select("endpoint, params, data").eq("client_id", clientId).in("endpoint", ["competitors", "kw_shared", "kw_gap", "comp_pages"]);
  const rows = data ?? [];
  const auto = ((rows.find((r) => r.endpoint === "competitors")?.data ?? []) as Row[]);
  const tracked = target.competitors.length ? target.competitors : auto.filter((a) => a.domain !== target.domain).slice(0, 3).map((a) => String(a.domain));
  if (!tracked.length) throw new Error("No competitors are stored yet. Run the analysis on the Competitors page first.");
  const per = (ep: string, d: string) => rows.find((r) => r.endpoint === ep && String((r.params as Row)?.competitor ?? (r.params as Row)?.target ?? (r.params as Row)?.target1) === d)?.data;
  const stats: CompStat[] = tracked.slice(0, 4).map((d) => {
    const a = auto.find((x) => x.domain === d) ?? {};
    const shared = ((per("kw_shared", d) as { rows?: Row[] } | undefined)?.rows ?? []);
    const gap = ((per("kw_gap", d) as { rows?: Row[] } | undefined)?.rows ?? []);
    const pages = ((per("comp_pages", d) ?? []) as Row[]);
    return {
      domain: d, shared: (a.shared as number) ?? null, keywords: (a.keywords as number) ?? null, traffic: (a.traffic as number) ?? null, avgPosition: (a.avg_position as number) ?? null,
      sharedKws: shared.slice(0, 12).map((r) => String(r.keyword)), gapKws: gap.slice(0, 12).map((r) => String(r.keyword)), topPages: pages.slice(0, 8).map((r) => String(r.page)),
    };
  });
  const res = await anthropic().beta.messages.parse({
    model: COMP_MODEL, max_tokens: 6000, thinking: { type: "disabled" },
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: "You plan comparison pages for a local sign and LED lighting business. For each competitor produce one 'vs' page outline, then ONE 'alternatives' page outline for the strongest competitor. Be fair and factual: never invent competitor prices, ratings or weaknesses; where a claim needs evidence, list it under proof_needed for the business to verify. 5-8 sections each, comparison_rows = the attributes of the comparison table (e.g. 'Local Houston fabrication'). slug lower-case with hyphens. Use the keywords provided to choose target_keyword and section topics.",
    messages: [{ role: "user", content: `Return exactly ${stats.length + 1} pages: one "vs" page for EACH of the ${stats.length} competitors below, then one "alternatives" page.\nBrand: ${brand} (${target.domain})\n\n${stats.map((s) => `Competitor ${s.domain}: ${s.keywords ?? "?"} ranking keywords, ~${Math.round(s.traffic ?? 0)} monthly organic visits, ${s.shared ?? "?"} keywords shared with us.\nShared keywords: ${s.sharedKws.join(", ") || "none"}\nKeywords they rank for and we don't: ${s.gapKws.join(", ") || "none"}\nTheir top pages: ${s.topPages.join(" ") || "none"}`).join("\n\n")}` }],
  });
  if (!res.parsed_output) throw new Error("The AI didn't return outlines. Try again.");
  const cost = (res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output) / 1_000_000;
  return { brand, stats, pages: res.parsed_output.pages, cost: Number(cost.toFixed(5)) };
}
