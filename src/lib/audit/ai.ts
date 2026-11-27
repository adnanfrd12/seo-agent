import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AI_MODEL, costUsd } from "@/lib/ai/claude";
import type { AiFix, AltSuggestion, AuditDetail, ImageRow } from "./details";
import { AI_FIX_MAX_ITEMS, ALT_BATCH, howTo } from "./guide";

/**
 * Claude for the Site Audit panels: "Fix with AI" writes the exact fix for each affected page / link / group,
 * and alt text suggests an alt and title per image after looking at it. Prompts are built by pure functions
 * (tested without the API); `ask` is the only network call and can be swapped in tests.
 */
export const AUDIT_AI_MODEL = AI_MODEL;

const fixSchema = z.object({
  summary: z.string(),
  fixes: z.array(z.object({ target: z.string(), action: z.string(), value: z.string().nullable(), why: z.string() })),
});
const altSchema = z.object({ images: z.array(z.object({ index: z.number().int(), alt: z.string(), title: z.string() })) });

type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
export interface AskInput { system: string; content: Block[]; schema: "fix" | "alt"; maxTokens: number }
export interface AskOutput { parsed: unknown; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }; model: string; refused: boolean }
export type Ask = (i: AskInput) => Promise<AskOutput>;

/** The real call on the organization's Claude client (anthropicFor): structured output, refusal fallback on the server. */
export const askClaude = (ai: Anthropic): Ask => async ({ system, content, schema, maxTokens }) => {
  const res = await ai.beta.messages.parse({
    model: AUDIT_AI_MODEL, max_tokens: maxTokens, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema === "fix" ? fixSchema : altSchema) },
    system, messages: [{ role: "user", content }],
  });
  return { parsed: res.parsed_output, usage: res.usage, model: res.model, refused: res.stop_reason === "refusal" };
};

/* ------------------------------------------------------------------ Fix with AI */
const FIX_SYSTEM = "You are a senior technical SEO fixing problems a site crawler found. For every affected item you are given, write the exact fix a site owner can paste or apply: new title / meta description / H1 text, the redirect rule (from → to), the replacement link URL (choose from the site's live pages when one fits), the canonical tag, the HTML correction, or the concrete content change. Be specific to each page, never generic. Keep titles 30-60 characters and descriptions 70-160 characters, written for humans with the main keyword early. If an item needs no change, say so in action and set value to null. target = the page URL, link, or group the fix applies to. action = one short imperative sentence. value = the exact text/code to use, or null. why = at most 15 words. summary = two sentences on the overall pattern and what to do first.";

/** The affected items in compact form, at most AI_FIX_MAX_ITEMS. */
export function fixItems(d: AuditDetail): unknown[] {
  if (d.kind === "groups") return (d.groups ?? []).slice(0, AI_FIX_MAX_ITEMS).map((g) => ({ group: g.label, pages: g.pages.slice(0, 8).map((p) => ({ url: p.url, title: p.title })) }));
  const keep = new Set(d.columns.map((c) => c.key).concat(["url", "title", "description", "h1", "words", "status", "location", "canonical", "from", "to", "anchor", "message", "line"]));
  return d.rows.slice(0, AI_FIX_MAX_ITEMS).map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => keep.has(k) && v !== null && v !== "")));
}

export function buildFixPrompt(d: AuditDetail, site: { domain: string; livePages: string[] }): AskInput {
  const items = fixItems(d);
  const text = [
    `Website: ${site.domain}`,
    `Issue: ${d.label}`,
    `Standard guidance: ${howTo(d.key).join(" ")}`,
    site.livePages.length ? `Live pages on the site (for redirect and link targets):\n${site.livePages.slice(0, 150).join("\n")}` : "",
    `Affected items (${items.length}${d.total > items.length ? ` of ${d.total}` : ""}):\n${JSON.stringify(items, null, 0)}`,
    "Return one fix per affected item, in the same order.",
  ].filter(Boolean).join("\n\n");
  return { system: FIX_SYSTEM, content: [{ type: "text", text }], schema: "fix", maxTokens: 12000 };
}

export function readFix(out: AskOutput): { summary: string; fixes: AiFix[] } {
  if (out.refused) throw new Error("Claude declined this request.");
  const r = fixSchema.safeParse(out.parsed);
  if (!r.success) throw new Error("Claude's answer couldn't be read. Try again.");
  return {
    summary: r.data.summary.slice(0, 800),
    fixes: r.data.fixes.slice(0, AI_FIX_MAX_ITEMS).map((f) => ({ target: f.target.slice(0, 500), action: f.action.slice(0, 300), value: f.value?.slice(0, 2000) ?? null, why: f.why.slice(0, 200) })),
  };
}

export async function runFix(d: AuditDetail, site: { domain: string; livePages: string[] }, ask: Ask) {
  const out = await ask(buildFixPrompt(d, site));
  return { ...readFix(out), cost: Number(costUsd(out.usage).toFixed(5)), model: out.model };
}

/* ------------------------------------------------------------------ image alt text */
const ALT_SYSTEM = "You write image alt text and image titles for a business website. Look at each image. alt = what the image shows and why it matters on that page, 5-15 words, no 'image of' / 'picture of', mention the product, service or place naturally when visible, no keyword stuffing; for a purely decorative image (spacer, background texture, divider) return an empty alt. title = a short 2-6 word caption. Return one entry per image using the index given.";
const TYPES = { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 } as const;
type Media = keyof typeof TYPES;
const extType = (u: string): Media | null => {
  const e = u.split("?")[0].split(".").pop()?.toLowerCase();
  return e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "png" ? "image/png" : e === "gif" ? "image/gif" : e === "webp" ? "image/webp" : null;
};

/** Images Claude can read (jpeg, png, gif, webp) that don't have a suggestion yet, at most ALT_BATCH. */
export function altCandidates(images: ImageRow[], done: Record<string, AltSuggestion> | undefined, skipped: string[] = []): ImageRow[] {
  return images.filter((i) => !done?.[i.src] && !skipped.includes(i.src) && !/\.(svg|avif|ico|bmp|tiff?)(\?|$)/i.test(i.src)).slice(0, ALT_BATCH);
}

/**
 * Downloads each image (the site can block Anthropic's fetcher, and one unreadable URL would fail the whole
 * request), and sends it as an image block. Images over 3.7 MB or of other types are skipped.
 */
export async function loadImage(src: string): Promise<{ media: Media; data: string } | null> {
  try {
    const res = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteAuditBot/1.0)", Accept: "image/*" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const media = (ct in TYPES ? ct : extType(src)) as Media | null;
    if (!media) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 3_700_000) return null;
    return { media, data: buf.toString("base64") };
  } catch { return null; }
}

export function buildAltPrompt(site: string, imgs: { row: ImageRow; media: Media; data: string }[]): AskInput {
  const content: Block[] = [{ type: "text", text: `Website: ${site}. ${imgs.length} images follow.` }];
  imgs.forEach(({ row, media, data }, i) => {
    content.push({ type: "text", text: `Image ${i}: ${row.src}\nOn page: ${row.pages[0]}${row.pageTitle ? ` ("${row.pageTitle}")` : ""}${row.pages.length > 1 ? ` and ${row.pages.length - 1} more` : ""}\nCurrent alt: ${row.alt || "(none)"} · current title: ${row.title || "(none)"}` });
    content.push({ type: "image", source: { type: "base64", media_type: media, data } });
  });
  return { system: ALT_SYSTEM, content, schema: "alt", maxTokens: 4000 };
}

export function readAlt(out: AskOutput, imgs: { row: ImageRow }[]): Record<string, AltSuggestion> {
  if (out.refused) throw new Error("Claude declined this request.");
  const r = altSchema.safeParse(out.parsed);
  if (!r.success) throw new Error("Claude's answer couldn't be read. Try again.");
  const map: Record<string, AltSuggestion> = {};
  for (const x of r.data.images) {
    const img = imgs[x.index];
    if (img) map[img.row.src] = { alt: x.alt.trim().slice(0, 250), title: x.title.trim().slice(0, 120) };
  }
  return map;
}

export async function runAlt(site: string, rows: ImageRow[], ask: Ask) {
  const loaded = (await Promise.all(rows.map(async (row) => ({ row, img: await loadImage(row.src) }))))
    .filter((x): x is { row: ImageRow; img: { media: Media; data: string } } => x.img !== null).map((x) => ({ row: x.row, ...x.img }));
  const skipped = rows.filter((r) => !loaded.some((l) => l.row.src === r.src)).map((r) => r.src);
  if (!loaded.length) return { suggestions: {}, cost: 0, model: AUDIT_AI_MODEL, skipped };
  const out = await ask(buildAltPrompt(site, loaded));
  return { suggestions: readAlt(out, loaded), cost: Number(costUsd(out.usage).toFixed(5)), model: out.model, skipped };
}
