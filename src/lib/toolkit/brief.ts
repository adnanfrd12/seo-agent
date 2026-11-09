import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic } from "@/lib/ai/claude";
import { demand, fetchHtml, fetchSerp, outline, siteKeywords, storedSerps, type Serp } from "./store";

/**
 * SERP-driven content brief: one DataForSEO Google search (~$0.002), the top 5 ranking pages read for free,
 * then Claude Sonnet 5.5 writes the brief (~$0.03). Structure adapted from the seo-content-brief skill of the
 * MIT-licensed claude-seo project (https://github.com/AgricIDaniel/claude-seo).
 */
export const BRIEF_MODEL = "claude-sonnet-5-5";
const PRICE = { input: 2, output: 10 }; // $ per million tokens, claude-sonnet-5-5

const schema = z.object({
  title_tag: z.string(), meta_description: z.string(), h1: z.string(), url_slug: z.string(),
  search_intent: z.string(), target_words: z.number().int(), page_type: z.string(),
  sections: z.array(z.object({ heading: z.string(), level: z.number().int(), words: z.number().int(), notes: z.string() })),
  keyword_placement: z.array(z.object({ where: z.string(), phrase: z.string() })),
  secondary_keywords: z.array(z.string()), questions: z.array(z.string()),
  entities: z.array(z.string()), internal_links: z.array(z.string()), differentiators: z.array(z.string()),
  schema_types: z.array(z.string()),
});
export type Brief = z.infer<typeof schema>;
export interface Competitor { position: number; url: string; domain: string; title: string; words: number; headings: number; questions: number; kwInTitle: boolean; kwInH1: boolean; score: number }
export interface BriefRun { keyword: string; brief: Brief; competitors: Competitor[]; serps: Serp[]; cost: { serp: number; ai: number } }

export async function defaultBriefKeyword(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const kws = await siteKeywords(admin, clientId);
  const opp = kws.filter((k) => k.position != null && k.position > 4 && k.position <= 30 && k.keyword.split(" ").length >= 2).sort((a, b) => demand(b) - demand(a));
  return opp[0]?.keyword ?? kws.sort((a, b) => demand(b) - demand(a))[0]?.keyword ?? null;
}

export async function runBrief(admin: SupabaseClient, clientId: string, keyword: string, target: { domain: string; location_code: number; language_code: string }): Promise<BriefRun> {
  const cached = (await storedSerps(admin, clientId)).get(keyword.toLowerCase());
  const { serp, cost: serpCost } = cached ? { serp: cached, cost: 0 } : await fetchSerp(admin, clientId, keyword, target.location_code, target.language_code);
  const kw = keyword.toLowerCase();
  const top = serp.organic.filter((o) => !o.domain.endsWith(target.domain.replace(/^www\./, ""))).slice(0, 5);
  const pages = await Promise.all(top.map(async (o) => {
    const r = await fetchHtml(o.url, 15_000);
    const ol = r.html ? outline(r.html) : null;
    const words = ol?.words ?? 0, headings = ol?.headings.length ?? 0;
    const questions = ol?.headings.filter((h) => /\?$/.test(h.text)).length ?? 0;
    const kwInTitle = (ol?.title ?? o.title).toLowerCase().includes(kw);
    const kwInH1 = Boolean(ol?.headings.find((h) => h.level === 1)?.text.toLowerCase().includes(kw));
    const score = Math.round(Math.min(words, 2000) / 2000 * 40 + Math.min(headings, 15) / 15 * 25 + Math.min(questions, 5) * 3 + (kwInTitle ? 10 : 0) + (kwInH1 ? 10 : 0));
    return { comp: { position: o.position, url: o.url, domain: o.domain, title: ol?.title ?? o.title, words, headings, questions, kwInTitle, kwInH1, score }, ol };
  }));
  const site = await siteKeywords(admin, clientId);
  const ourPages = [...new Set(site.map((k) => k.url).filter(Boolean))].slice(0, 30);
  const context = pages.map(({ comp, ol }) => `#${comp.position} ${comp.url} (${comp.words} words)\nTitle: ${comp.title}\nOutline: ${(ol?.headings ?? []).slice(0, 25).map((h) => `H${h.level} ${h.text}`).join(" | ")}`).join("\n\n");
  const res = await anthropic().beta.messages.parse({
    model: BRIEF_MODEL, max_tokens: 4000, thinking: { type: "between_tools" }, // Sonnet 5.5: "between_tools" is how thinking is turned off
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system: "You are a senior SEO content strategist writing a content brief for a writer at a local sign and LED lighting business. Base the brief on what currently ranks: match the dominant intent and page type, cover the topics every top result covers, and add what they miss. Section word counts must add up to target_words. internal_links must be URLs from the provided site list. Never recommend FAQ or HowTo rich results; FAQ sections for readers are fine.",
    messages: [{ role: "user", content: `Keyword: ${keyword}\nSite: ${target.domain}\nSERP features: ${serp.features.join(", ") || "none"}\nPeople also ask: ${serp.paa.join(" | ") || "none"}\nRelated searches: ${serp.related.join(" | ") || "none"}\nTop 10 titles: ${serp.organic.map((o) => `#${o.position} ${o.domain}: ${o.title}`).join(" | ")}\n\nTop competitor pages:\n${context}\n\nSite pages available for internal links:\n${ourPages.join("\n")}` }],
  });
  if (!res.parsed_output) throw new Error("The AI didn't return a brief. Try again.");
  const ai = (res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output) / 1_000_000;
  return { keyword, brief: res.parsed_output, competitors: pages.map((p) => p.comp), serps: [serp], cost: { serp: serpCost, ai: Number(ai.toFixed(4)) } };
}
