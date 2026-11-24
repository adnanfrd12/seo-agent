import type { QuickWinItem } from "./schema";
import type { Candidate } from "./types";

/**
 * Checks Claude's answer before anything is saved (pure functions, unit-tested): known candidate, known page,
 * no numbers that aren't in the candidate's data, title/meta lengths, banned words.
 */
export const EFFORT_W = { Low: 1, Medium: 2, High: 3 } as const;
export const CONF_W = { High: 1, Medium: 0.75, Low: 0.5 } as const;
/** Characters of slack around the 50–60 (title) and 140–160 (meta) targets before an item is sent back for repair. */
export const LENGTH_SLACK = 5;

const NUM_RE = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)/g;
/** Numbers any sentence may use without coming from the data: small counts, common periods, years. */
const FREE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 24, 28, 30, 31, 60, 90, 100, 365]);

export function numbersIn(text: string): { value: number; pct: boolean; raw: string }[] {
  const out: { value: number; pct: boolean; raw: string }[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const value = Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
    if (Number.isFinite(value)) out.push({ value, pct: m[3] === "%", raw: m[0] });
  }
  return out;
}

/** Every number present anywhere in a candidate (facts, queries, page context, draft, gain). */
export function allowedNumbers(c: Candidate): number[] {
  const nums: number[] = [c.computed_gain];
  const walk = (v: unknown) => {
    if (typeof v === "number") nums.push(v);
    else if (typeof v === "string") for (const n of numbersIn(v)) nums.push(n.pct ? n.value / 100 : n.value);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk({ facts: c.facts, queries: c.queries, page_context: c.page_context, draft: c.draft, page_url: c.page_url });
  return nums;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.006);

/** Numbers in `text` that can't be traced to the candidate (allowing rounding, and fractions shown as percentages). */
export function unknownNumbers(text: string, c: Candidate): string[] {
  const allowed = allowedNumbers(c);
  const bad: string[] = [];
  for (const n of numbersIn(text)) {
    if (!n.pct && (FREE.has(n.value) || (n.value >= 2000 && n.value <= 2035))) continue;
    const ok = allowed.some((a) => close(n.value, a) || (n.pct && (close(n.value / 100, a) || close(n.value, a * 100))) || close(n.value, Math.round(a)) || (!n.pct && close(n.value, a * 100)));
    if (!ok) bad.push(n.raw);
  }
  return bad;
}

const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u.trim(); } };

/** Title and meta description lines in a suggested change ("Title: …", "Meta description: …"). */
export function suggestedLengths(s: string | null): { title: number[]; meta: number[] } {
  const out = { title: [] as number[], meta: [] as number[] };
  if (!s) return out;
  for (const line of s.split(/\n/)) {
    const m = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(new\s+)?(title(?: tag)?|meta(?: description)?)(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+)$/i);
    if (!m) continue;
    const text = m[3].trim().replace(/^["“'`]|["”'`]$/g, "").replace(/\s*\(\d+\s*(?:characters|chars)\)\s*$/i, "").trim();
    if (/^title/i.test(m[2])) out.title.push(text.length); else out.meta.push(text.length);
  }
  return out;
}

export function bannedIn(item: QuickWinItem, banned: string[]): string[] {
  if (!banned.length) return [];
  const text = [item.title, item.where, item.why, ...item.steps, item.suggested_change ?? "", item.plain_summary, item.measure].join(" \n ").toLowerCase();
  return banned.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(text));
}

/** null when the item is fine, else the reasons (sent back to Claude once for a repair). */
/** `also` = candidates merged into this item, whose numbers it may quote too. */
export function validateItem(item: QuickWinItem, byId: Map<string, Candidate>, inventory: Set<string>, banned: string[], also: Candidate[] = []): string[] | null {
  const c = byId.get(item.candidate_id);
  if (!c) return [`candidate_id "${item.candidate_id}" is not in this chunk`];
  if (!item.keep) return null;
  const errs: string[] = [];
  const p = path(item.page_url);
  if (p !== c.page_url && !inventory.has(p)) errs.push(`page_url "${item.page_url}" is not a page in the data; use "${c.page_url}"`);
  const bad = unknownNumbers(item.why, also.length ? { ...c, facts: [...c.facts, ...also.flatMap((x) => x.facts)], queries: [...c.queries, ...also.flatMap((x) => x.queries)] } : c);
  if (bad.length) errs.push(`why quotes numbers that are not in the candidate's data: ${bad.join(", ")}`);
  if (item.title.length > 120) errs.push(`title is ${item.title.length} characters (max 120)`);
  if (item.steps.length < 2 || item.steps.length > 8) errs.push(`steps has ${item.steps.length} entries (3 to 6 expected)`);
  const len = suggestedLengths(item.suggested_change);
  for (const t of len.title) if (t < 50 - LENGTH_SLACK || t > 60 + LENGTH_SLACK) errs.push(`suggested title is ${t} characters (50 to 60)`);
  for (const t of len.meta) if (t < 140 - LENGTH_SLACK || t > 160 + LENGTH_SLACK) errs.push(`suggested meta description is ${t} characters (140 to 160)`);
  const words = bannedIn(item, banned);
  if (words.length) errs.push(`uses banned words: ${words.join(", ")}`);
  return errs.length ? errs : null;
}

/** Score = gain (leads weighted as 10 clicks) × confidence weight ÷ effort weight. */
export function scoreOf(weightedGain: number, confidence: keyof typeof CONF_W, effort: keyof typeof EFFORT_W) {
  return Math.round((weightedGain * CONF_W[confidence] / EFFORT_W[effort]) * 100) / 100;
}
