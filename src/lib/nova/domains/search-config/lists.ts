import { z } from "zod";

/**
 * Editing the term lists behind the Search Console and GA4 settings (brand / competitor / city / service lists,
 * the GA4 service area). An empty saved list means "automatic" on those screens.
 */
export const LIST_ACTIONS = ["add", "remove", "replace", "automatic"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];
export interface ListChange { action: ListAction; terms: string[] }

export const termsArg = (max: number, len = 120) => z.array(z.string().trim().min(1).max(len)).max(max).default([]);

/** Splits on commas and new lines (as the dashboard's forms do), trims, optionally lowercases, de-duplicates ignoring case. */
export function cleanTerms(terms: readonly string[], lower: boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms.flatMap((x) => x.split(/[\n,]/))) {
    const t = raw.trim().replace(/\s+/g, " ");
    const v = lower ? t.toLowerCase() : t;
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/**
 * Applies changes, in order, to `base` (the list as it is used now). Returns the list to save ([] = automatic), the
 * terms a remove didn't find and the terms an add found already there.
 */
export function editList(base: readonly string[], changes: ListChange[], lower: boolean): { list: string[]; missing: string[]; present: string[] } | { error: string } {
  if (changes.some((c) => c.action === "automatic")) {
    return changes.length === 1 ? { list: [], missing: [], present: [] } : { error: '"automatic" can\'t be combined with other changes to the same list.' };
  }
  let cur = cleanTerms(base, lower);
  const missing: string[] = [], present: string[] = [];
  for (const c of changes) {
    const terms = cleanTerms(c.terms, lower);
    if (c.action === "replace") { cur = terms; continue; }
    if (!terms.length) return { error: `"${c.action}" needs at least one term.` };
    const have = new Set(cur.map((t) => t.toLowerCase()));
    if (c.action === "add") {
      present.push(...terms.filter((t) => have.has(t.toLowerCase())));
      cur = cleanTerms([...cur, ...terms], lower);
    } else {
      missing.push(...terms.filter((t) => !have.has(t.toLowerCase())));
      const drop = new Set(terms.map((t) => t.toLowerCase()));
      cur = cur.filter((t) => !drop.has(t.toLowerCase()));
    }
  }
  return { list: cur, missing, present };
}

/** Notes for a Confirm card about terms that were already there / not there. */
export function termNotes(label: string, r: { missing: string[]; present: string[] }): string[] {
  const is = (n: number) => (n === 1 ? "is" : "are");
  return [
    r.present.length ? `${label}: ${quoteList(r.present)} ${is(r.present.length)} already in the list.` : "",
    r.missing.length ? `${label}: ${quoteList(r.missing)} ${is(r.missing.length)}n't in the list.` : "",
  ].filter(Boolean);
}

/** Added / removed terms between two lists (ignoring case). */
export function diffTerms(before: readonly string[], after: readonly string[]) {
  const b = new Set(before.map((t) => t.toLowerCase())), a = new Set(after.map((t) => t.toLowerCase()));
  return { added: after.filter((t) => !b.has(t.toLowerCase())), removed: before.filter((t) => !a.has(t.toLowerCase())) };
}

export const sameTerms = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t.toLowerCase() === b[i]?.toLowerCase());

/** `"a", "b", "c" and 4 more` */
export function quoteList(terms: readonly string[], max = 8): string {
  if (!terms.length) return "(none)";
  const shown = terms.slice(0, max).map((t) => `"${t}"`).join(", ");
  return terms.length > max ? `${shown} and ${terms.length - max} more` : shown;
}

/** One Confirm-card line for a list change: `Cities (saved, 20 → 21): + "katy"; − "spring"`. */
export function changeLine(label: string, before: { list: readonly string[]; source: string }, after: { list: readonly string[]; source: string }): string | null {
  const { added, removed } = diffTerms(before.list, after.list);
  if (!added.length && !removed.length && before.source === after.source) return null;
  const parts = [added.length ? `+ ${quoteList(added)}` : "", removed.length ? `− ${quoteList(removed)}` : ""].filter(Boolean);
  const src = before.source === after.source ? after.source.toLowerCase() : `${before.source.toLowerCase()} → ${after.source.toLowerCase()}`;
  return `${label} (${src}, ${before.list.length} → ${after.list.length}): ${parts.length ? parts.join("; ") : "same terms"}`;
}

type Slot = { o: Record<string, unknown>; k: string; n: number };
/** The longest list (by JSON size) in an object, looking into nested objects (not into list items). */
function longest(o: Record<string, unknown>): Slot | null {
  let best: Slot | null = null;
  for (const [k, x] of Object.entries(o)) {
    const c: Slot | null = Array.isArray(x) ? (x.length > 1 ? { o, k, n: JSON.stringify(x).length } : null)
      : x && typeof x === "object" ? longest(x as Record<string, unknown>) : null;
    if (c && (!best || c.n > best.n)) best = c;
  }
  return best;
}

/** Compact JSON for read tools, kept under `max` characters by halving the longest lists first. */
export function fit(v: Record<string, unknown>, max = 12_000): string {
  let s = JSON.stringify(v);
  for (let i = 0; s.length > max && i < 16; i++) {
    const b = longest(v);
    if (!b) break;
    b.o[b.k] = (b.o[b.k] as unknown[]).slice(0, Math.ceil((b.o[b.k] as unknown[]).length / 2));
    v.truncated = "Some lists were shortened to keep the answer small.";
    s = JSON.stringify(v);
  }
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const clip = (s: string | null | undefined, n: number) => (!s ? s ?? null : s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
export const r4 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);
