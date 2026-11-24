import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigured } from "@/lib/notify";
import { collectBatch } from "./claude";
import { clientSettings, finishBatch, submitNightly } from "./run";
import { clearPending, loadItems, loadPending } from "./store";
import type { RunState, StoredWin } from "./types";

/**
 * Nightly quick wins for every client that switched it on: "submit" gathers candidates and sends one Message Batch
 * per client (half price); "collect" (a few hours later) reads finished batches by custom_id, validates and saves
 * exactly like a live run, then emails the morning summary.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export async function nightlyClients(admin: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data } = await admin.from("clients").select("id, name, settings").limit(500);
  return (data ?? []).filter((c) => ((c.settings as Record<string, unknown> | null)?.ai_qw as { nightly?: boolean } | undefined)?.nightly === true).map((c) => ({ id: c.id, name: c.name }));
}

export async function submitAll(admin: SupabaseClient): Promise<{ client: string; status: string; error?: string | null }[]> {
  const out: { client: string; status: string; error?: string | null }[] = [];
  for (const c of await nightlyClients(admin)) {
    if (await loadPending(admin, c.id)) { out.push({ client: c.name, status: "skipped: a batch is still pending" }); continue; }
    const r = await submitNightly(admin, c.id);
    out.push({ client: c.name, status: r.status, error: r.error });
  }
  return out;
}

export async function collectAll(admin: SupabaseClient): Promise<{ client: string; status: string; emailed?: boolean }[]> {
  const out: { client: string; status: string; emailed?: boolean }[] = [];
  for (const c of await nightlyClients(admin)) {
    const p = await loadPending(admin, c.id);
    if (!p) continue;
    const { settings } = await clientSettings(admin, c.id);
    const results = await collectBatch(settings, p.batchId).catch(() => null);
    if (!results) {
      // still processing (or unreachable): try again on the next collect; give up after 30 hours
      if (Date.now() - Date.parse(p.submittedAt) > 30 * 3_600_000) { await clearPending(admin, c.id); out.push({ client: c.name, status: "expired" }); }
      else out.push({ client: c.name, status: "processing" });
      continue;
    }
    const before = await loadItems(admin, c.id);
    const run = await finishBatch(admin, c.id, p.runId, p.chunks, results);
    await clearPending(admin, c.id);
    const emailed = run ? await morningEmail(admin, c.id, c.name, run, before, settings.emailTo) : false;
    out.push({ client: c.name, status: run?.status ?? "missing run", emailed });
  }
  return out;
}

/** Top 5 new quick wins, those resolved by the data, and results of items done 28+ days ago. */
async function morningEmail(admin: SupabaseClient, clientId: string, name: string, run: RunState, before: StoredWin[], to: string[]): Promise<boolean> {
  if (!emailConfigured() || !run.diff) return false;
  try {
    let emails = to;
    if (!emails.length) {
      const { data: members } = await admin.from("client_members").select("user_id").eq("client_id", clientId).in("role", ["owner", "admin"]).limit(10);
      for (const m of members ?? []) { const { data } = await admin.auth.admin.getUserById(m.user_id as string); if (data?.user?.email) emails = [...emails, data.user.email]; }
    }
    if (!emails.length) return false;
    const items = await loadItems(admin, clientId);
    const byKey = new Map(items.map((w) => [w.key, w])), was = new Map(before.map((w) => [w.key, w]));
    const fresh = run.diff.added.map((k) => byKey.get(k)).filter((w): w is StoredWin => Boolean(w)).sort((a, b) => b.score - a.score).slice(0, 5);
    const resolved = run.diff.resolved.map((k) => was.get(k)?.title ?? k).slice(0, 8);
    const results = items.filter((w) => w.result && w.baseline && !was.get(w.key)?.result).slice(0, 5);
    const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    const li = (s: string) => `<li style="margin-bottom:8px">${s}</li>`;
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px"><h2 style="margin:0 0 4px">${esc(name)}: quick wins this morning</h2><p style="color:#666;margin:0 0 16px">${run.counts.kept} quick wins checked overnight.</p>`
      + (fresh.length ? `<h3>Top new quick wins</h3><ol>${fresh.map((w) => li(`<strong>${esc(w.title)}</strong><br><span style="color:#555">${esc(w.plain_summary)} (+${w.computed_gain} ${w.gain_unit}, effort ${w.effort})</span>`)).join("")}</ol>` : "")
      + (resolved.length ? `<h3>Resolved by the data</h3><ul>${resolved.map((t) => li(esc(t))).join("")}</ul>` : "")
      + (results.length ? `<h3>Results of changes made 28+ days ago</h3><ul>${results.map((w) => li(`<strong>${esc(w.title)}</strong>: clicks ${w.baseline!.clicks ?? "–"} → ${w.result!.clicks ?? "–"}, impressions ${w.baseline!.impressions ?? "–"} → ${w.result!.impressions ?? "–"}`)).join("")}</ul>` : "")
      + (app ? `<p><a href="${app}/ai-quick-wins">Open all quick wins</a></p>` : "") + `</div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM!.trim(), to: emails, subject: `${name}: ${fresh.length} new quick win${fresh.length === 1 ? "" : "s"} this morning`, html }),
    });
    return res.ok;
  } catch { return false; }
}
