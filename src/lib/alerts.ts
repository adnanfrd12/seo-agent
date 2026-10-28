import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadCompetitors } from "@/lib/dataforseo/competitors";
import { detectLinkSpike, type LinkChange, type LinkChanges } from "@/lib/dataforseo/research";
import { emailClientAlerts } from "@/lib/notify";

/**
 * Daily change detection. Everything here reads stored data (no paid API calls); each alert has a
 * dedupe key, so the same situation is reported once, not every day.
 */
type Totals = { has_data?: boolean } & Record<string, unknown>;
type Compared = { current?: Totals; previous?: Totals } | null;
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const weekKey = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return shiftDays(iso, -day);
};

export async function generateAlerts(admin: SupabaseClient, clientId: string, timezone = "UTC"): Promise<number> {
  const today = todayIn(timezone);
  let created = 0;
  const fresh: { severity: string; title: string; body: string }[] = []; // new critical/warning alerts, emailed once at the end
  const put = async (kind: string, severity: "info" | "warning" | "critical" | "positive", title: string, body: string, dedupe: string, data: Record<string, unknown> = {}) => {
    const { data: row } = await admin.from("client_alerts")
      .upsert({ client_id: clientId, kind, severity, title, body, dedupe_key: dedupe, data }, { onConflict: "client_id,dedupe_key", ignoreDuplicates: true }).select("id");
    if (row?.length) {
      created++;
      if (severity === "critical" || severity === "warning") fresh.push({ severity, title, body });
    }
  };

  // 1. week-over-week movement in the main traffic metrics (GSC reports with a 2-3 day delay)
  const end = shiftDays(today, -3), start = shiftDays(end, -6);
  const { data: ov } = await admin.rpc("get_seo_overview", { p_client_id: clientId, p_start: start, p_end: end });
  const o = ov as { ga4?: Compared; gsc?: Compared; gbp?: Compared } | null;
  const moves: [string, string, Compared | undefined, string, number][] = [
    ["Search clicks", "gsc", o?.gsc, "clicks", 30], ["Website sessions", "ga4", o?.ga4, "sessions", 50], ["Business Profile views", "gbp", o?.gbp, "impressions", 100],
  ];
  for (const [label, src, c, key, minBase] of moves) {
    const cur = n(c?.current?.[key]), prev = n(c?.previous?.[key]);
    if (!c?.current?.has_data || !c?.previous?.has_data || prev < minBase) continue;
    const pct = ((cur - prev) / prev) * 100;
    if (pct <= -30) await put(`${src}_drop`, "warning", `${label} fell ${Math.abs(pct).toFixed(0)}% week over week`, `${prev.toLocaleString("en-US")} → ${cur.toLocaleString("en-US")} (${start} to ${end} vs the 7 days before). Check for ranking losses, tracking issues or seasonality.`, `${src}_drop:${weekKey(today)}`, { cur, prev, pct });
    else if (pct >= 30 && cur >= minBase) await put(`${src}_gain`, "positive", `${label} grew ${pct.toFixed(0)}% week over week`, `${prev.toLocaleString("en-US")} → ${cur.toLocaleString("en-US")} (${start} to ${end} vs the 7 days before).`, `${src}_gain:${weekKey(today)}`, { cur, prev, pct });
  }

  // 2. integrations that are broken or stale
  const { data: conns } = await admin.from("integration_connections").select("provider, status, last_error, last_synced_at").eq("client_id", clientId);
  const lbmOk = (conns ?? []).some((c) => c.provider === "lbm" && c.status === "connected");
  const label: Record<string, string> = { ga4: "Google Analytics 4", gsc: "Search Console", gbp: "Google Business Profile", lbm: "Local Brand Manager", bing: "Bing Webmaster Tools", clarity: "Microsoft Clarity" };
  for (const c of conns ?? []) {
    if (c.provider === "gbp" && lbmOk) continue; // Business Profile data arrives through Local Brand Manager instead
    if (c.status === "error" || (c.status === "connected" && c.last_error)) {
      await put("integration_error", "warning", `${label[c.provider] ?? c.provider} needs attention`, String(c.last_error ?? "The connection reported an error.").slice(0, 300), `conn:${c.provider}:${today.slice(0, 7)}`, { provider: c.provider });
    } else if (c.status === "connected" && c.last_synced_at && Date.now() - Date.parse(c.last_synced_at) > 3 * 86_400_000) {
      await put("integration_stale", "warning", `${label[c.provider] ?? c.provider} hasn't synced for 3+ days`, "Scheduled syncs may be failing. Open Integrations to see the last error and run a manual sync.", `stale:${c.provider}:${weekKey(today)}`, { provider: c.provider });
    }
  }

  // 3. backlinks: an unusual jump in new referring domains
  const { data: nl } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "new_lost").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  const spike = nl?.data ? detectLinkSpike(nl.data as { date: string | null; new_backlinks: number; new_domains: number }[]) : null;
  if (spike) await put("link_spike", "critical", `Unusual jump in new backlinks (${spike.month})`, `${spike.newDomains.toLocaleString("en-US")} new referring domains versus a usual ${spike.baseline}/month. This often means a link farm or negative SEO. Review the anchors and referring domains.`, `link_spike:${spike.month}`, { ...spike });

  // 3b. individual backlinks gained or lost since the previous daily check (stored by the research job)
  const { data: lc } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "link_changes").maybeSingle();
  const changes = (lc?.data as LinkChanges | undefined)?.events.filter((e) => e.detected === new Date().toISOString().slice(0, 10)) ?? []; // detected dates are UTC
  if (changes.length) {
    const strong = (e: LinkChange) => (e.rank ?? 0) >= 100 || (e.domain_rank ?? 0) >= 300; // link or domain authority worth noticing
    const lostStrong = changes.filter((e) => e.kind === "lost" && strong(e));
    const newStrong = changes.filter((e) => e.kind === "new" && strong(e) && (e.spam ?? 0) < 50);
    const newSpam = changes.filter((e) => e.kind === "new" && (e.spam ?? 0) >= 50);
    const names = (list: LinkChange[]) => [...new Set(list.map((e) => e.domain).filter(Boolean))].slice(0, 4).join(", ");
    if (lostStrong.length) await put("links_lost", "warning", `Lost ${lostStrong.length} valuable backlink${lostStrong.length > 1 ? "s" : ""}`, `Including links from ${names(lostStrong)}. Check whether the linking pages were removed or changed, and consider reaching out to restore them.`, `links_lost:${today}`, { count: lostStrong.length });
    if (newStrong.length) await put("links_gained", "positive", `Gained ${newStrong.length} strong backlink${newStrong.length > 1 ? "s" : ""}`, `New links from ${names(newStrong)}.`, `links_gained:${today}`, { count: newStrong.length });
    if (newSpam.length >= 3) await put("links_spam", "warning", `${newSpam.length} new backlinks look spammy`, `Spam score 50 or higher, e.g. from ${names(newSpam)}. Review them under Backlinks → New links; spam links can be disavowed in Google Search Console.`, `links_spam:${today}`, { count: newSpam.length });
  }

  // 4. competitors gaining ground
  const comp = await loadCompetitors(admin, clientId);
  for (const t of comp.threats.slice(0, 3)) {
    await put("competitor", t.kind === "overtaking" ? "warning" : "info", t.kind === "overtaking" ? `${t.domain} overtook you in organic keywords` : `${t.domain} is gaining organic visibility`,
      `Ranking keywords ${t.keywordsFrom.toLocaleString("en-US")} → ${t.keywordsTo.toLocaleString("en-US")} over ${Math.round(t.days)} days (DataForSEO estimate).`, `competitor:${t.domain}:${today.slice(0, 7)}`, { ...t });
  }

  // 5. unhappy customers: low-rated reviews in the last week
  const since = shiftDays(today, -7);
  const { data: lowRows } = await admin.from("gbp_reviews").select("remote_id, resource_id").eq("client_id", clientId).lte("rating", 2).gte("reviewed_at", `${since}T00:00:00Z`).limit(50);
  if (lowRows?.length) await put("negative_reviews", "warning", `${lowRows.length} new low-rated review${lowRows.length > 1 ? "s" : ""} (1–2 stars)`, "Replying promptly to unhappy customers protects your rating. See Business Profile → Google reviews.", `neg_reviews:${weekKey(today)}`, { count: lowRows.length });

  if (fresh.length) {
    const { data: c } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
    await emailClientAlerts(admin, clientId, c?.name ?? "Your client", fresh); // no-op unless email is configured
  }
  return created;
}

export interface AlertRow { id: string; kind: string; severity: "info" | "warning" | "critical" | "positive"; title: string; body: string | null; created_at: string; seen_at: string | null }

export async function loadAlerts(supabase: SupabaseClient, clientId: string, limit = 12): Promise<AlertRow[]> {
  const { data } = await supabase.from("client_alerts").select("id, kind, severity, title, body, created_at, seen_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as AlertRow[];
}
