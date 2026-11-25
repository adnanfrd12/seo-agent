import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSettings, type AiQwSettings } from "@/lib/aiqw/settings";

/** Read outputs stay under this many characters. */
export const MAX_OUT = 12_000;

/** Shortens text for compact outputs and Confirm cards. */
export const clip = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * JSON of `build(n)`, where n is the number of list items to include: all `total` if they fit in `max` characters,
 * otherwise the most that fit (at least one). `build` should report `shown` / `truncated` itself.
 */
export function fitJson(total: number, build: (n: number) => unknown, max = MAX_OUT): string {
  const s = (n: number) => JSON.stringify(build(n));
  const all = s(total);
  if (all.length <= max || total <= 1) return all;
  let lo = 1, hi = total - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (s(mid).length <= max) lo = mid; else hi = mid - 1;
  }
  return s(lo);
}

export const usd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** "about 45 seconds", "about 2 minutes", "about 3.5 minutes". */
export function duration(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const m = Math.round((seconds / 60) * 2) / 2;
  return `about ${m} minute${m === 1 ? "" : "s"}`;
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

/** The AI and data settings as stored (defaults for anything missing), without the Business Profile fill-ins. */
export async function storedSettings(admin: SupabaseClient, clientId: string): Promise<AiQwSettings> {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  return readSettings(((data?.settings ?? {}) as Record<string, unknown>).ai_qw);
}

/** Runs one async step per item in order; returns what failed (label: reason). */
export async function eachInOrder<T>(items: T[], step: (x: T) => Promise<string | null>): Promise<{ done: number; failed: string[] }> {
  let done = 0;
  const failed: string[] = [];
  for (const x of items) {
    const err = await step(x);
    if (err) failed.push(err); else done++;
  }
  return { done, failed };
}

/** The outcome of a bulk change: ok when anything changed, with the failures listed. */
export function bulkMessage(done: number, total: number, what: (n: number) => string, failed: string[]): { ok: boolean; message: string } {
  if (!done) return { ok: false, message: failed.length ? failed.slice(0, 5).join("; ") : "Nothing changed." };
  const head = done === total ? what(done) : `${what(done)} (${done} of ${total})`;
  return { ok: true, message: failed.length ? `${head}. Not changed: ${failed.slice(0, 5).join("; ")}${failed.length > 5 ? ` and ${failed.length - 5} more` : ""}.` : `${head}.` };
}
