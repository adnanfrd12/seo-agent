import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic } from "@/lib/ai/claude";
import { loadBlog, loadBlogPerformance } from "@/lib/blog/load";
import { pathOf } from "@/lib/blog/parse";
import { fetchHtml, outline, readability, type Readability } from "./store";

/**
 * Content quality: deterministic metrics (word count, Flesch readability, structure) plus a qualitative E-E-A-T and
 * AI-citation-readiness read by Claude Haiku 5.5 (structured output, thinking off: about $0.0005 per page).
 * Criteria adapted from the seo-content skill of the MIT-licensed claude-seo project (https://github.com/AgricIDaniel/claude-seo):
 * Google's Who/How/Why test, the four E-E-A-T factors and passage-level citability for AI answers.
 */
export const CONTENT_MODEL = "claude-haiku-5-5";
const PRICE = { input: 0.1, output: 0.5 }; // $ per million tokens, claude-haiku-5-5

const schema = z.object({
  experience: z.number().int().min(0).max(10), expertise: z.number().int().min(0).max(10),
  authoritativeness: z.number().int().min(0).max(10), trust: z.number().int().min(0).max(10),
  ai_citation: z.number().int().min(0).max(10),
  who_how_why: z.string(),
  strengths: z.array(z.string()), issues: z.array(z.string()), fixes: z.array(z.string()),
  citable_passage: z.string().nullable(),
});
export type ContentAi = z.infer<typeof schema>;

const SYSTEM = `You are a strict content-quality reviewer applying Google's helpful-content guidance and the Search Quality Rater E-E-A-T criteria to pages of a local business website. Score 0-10 each:
- experience: first-hand evidence (real projects, photos described, specific jobs, customer stories)
- expertise: accurate, specific, technical depth; named author or credentials
- authoritativeness: references, recognition, certifications, cited sources
- trust: contact details, address, pricing transparency, dates, guarantees, reviews
- ai_citation: how easily an AI answer engine could quote a self-contained passage (clear definitions, direct answers in the first 40-60 words of a section, facts with numbers, question headings)
who_how_why: one sentence answering who made it, how, and why it exists.
strengths / issues / fixes: 2-5 short, specific items each; fixes must be concrete edits.
citable_passage: the single best quotable sentence from the text, or null.
Judge only what the text shows. Be critical: generic marketing copy scores 3-5.`;

export interface ContentPage {
  url: string; title: string | null; words: number; read: Readability; headings: number; questionHeadings: number;
  thin: boolean; clicks: number | null; ai: ContentAi | null; score: number; error?: string;
}
export interface ContentRun { mode: "url" | "blog"; pages: ContentPage[]; cost: number; model: string }

async function reviewPage(url: string, extra: { clicks: number | null }): Promise<{ page: ContentPage; cost: number }> {
  const r = await fetchHtml(url);
  if (!r.html) return { page: { url, title: null, words: 0, read: readability(""), headings: 0, questionHeadings: 0, thin: true, clicks: extra.clicks, ai: null, score: 0, error: "Page didn't load" }, cost: 0 };
  const o = outline(r.html);
  const read = readability(o.text);
  const qh = o.headings.filter((h) => h.level > 1 && /\?$|^(how|what|why|when|where|which|who|can|do|does|is|are|should)\b/i.test(h.text)).length;
  let ai: ContentAi | null = null, cost = 0;
  try {
    const res = await anthropic().beta.messages.parse({
      model: CONTENT_MODEL, max_tokens: 1500, thinking: { type: "disabled" },
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `URL: ${url}\nTitle: ${o.title ?? ""}\nHeadings: ${o.headings.map((h) => `H${h.level} ${h.text}`).join(" | ").slice(0, 2000)}\n\n<page>\n${o.text.slice(0, 14_000)}\n</page>` }],
    });
    if (res.parsed_output) ai = res.parsed_output;
    cost = (res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output) / 1_000_000;
  } catch { /* metrics are still useful without the AI read */ }
  const thin = o.words < 500;
  // 60% qualitative (E-E-A-T + citation), 40% deterministic (length, readability, structure)
  const det = Math.min(100, (Math.min(o.words, 1200) / 1200) * 45 + Math.min(read.flesch, 70) / 70 * 35 + Math.min(qh, 4) * 5);
  const qual = ai ? ((ai.experience + ai.expertise + ai.authoritativeness + ai.trust) / 40) * 75 + (ai.ai_citation / 10) * 25 : null;
  const score = Math.round(qual == null ? det : qual * 0.6 + det * 0.4);
  return { page: { url: r.finalUrl, title: o.title, words: o.words, read, headings: o.headings.length, questionHeadings: qh, thin, clicks: extra.clicks, ai, score }, cost };
}

export async function runContent(admin: SupabaseClient, clientId: string, url: string | null): Promise<ContentRun> {
  if (url) {
    const { page, cost } = await reviewPage(url, { clicks: null });
    return { mode: "url", pages: [page], cost: Number(cost.toFixed(5)), model: CONTENT_MODEL };
  }
  const { posts } = await loadBlog(admin, clientId);
  if (!posts.length) throw new Error("No blog posts are stored yet. Sync them on the Blog Content page, or enter a URL.");
  const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const perf = await loadBlogPerformance(admin, clientId, { start, end });
  const ranked = posts.map((p) => ({ p, s: perf.get(pathOf(p.url)) })).sort((a, b) => (b.s?.clicks ?? 0) - (a.s?.clicks ?? 0) || (b.s?.impressions ?? 0) - (a.s?.impressions ?? 0)).slice(0, 10);
  const out = await Promise.all(ranked.map(({ p, s }) => reviewPage(p.url, { clicks: s?.clicks ?? 0 })));
  return { mode: "blog", pages: out.map((o) => o.page), cost: Number(out.reduce((a, o) => a + o.cost, 0).toFixed(5)), model: CONTENT_MODEL };
}
