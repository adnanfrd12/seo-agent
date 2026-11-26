import { GeoCards, type GeoCard } from "./geo-cards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtInt } from "@/lib/analytics/format";

type Geogrid = {
  id: string; search_term: string; scanned_at: string | null; state: string | null; agr: number | null; atgr: number | null; solv: number | null;
  grid_size: number | null; point_distance: number | null; distance_measure: string | null; ranks: (number | string)[][] | null;
  image_url: string | null; public_url: string | null;
};
type Resource = { id: string; display_name: string | null; metadata: Record<string, unknown> | null };
type Config = {
  id: string; period: string | null; month_day: number | null; hour: number | null; time_zone: string | null; scheduled_at: string | null;
  search_terms: { id: string; active: boolean; text: string; geogrids_count: number | null; processed_at: string | null }[];
};

const card = "rounded-[10px] border border-border bg-surface p-4";
const num = (v: unknown) => (v == null ? null : Number(v));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
/** LBM reports SoLV as a fraction (0.93 = 93%). */
const solvPct = (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`);
const safeUrl = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : null);

/**
 * What only Local Brand Manager provides: geogrid local-rank scans and their schedule, legacy insights and LBM
 * report links. (Reviews, keywords and business information are shown from one source per location in gbp-sections.)
 */
export async function LbmSections({ supabase, resourceIds }: {
  supabase: SupabaseClient; resourceIds: string[];
}) {
  if (resourceIds.length === 0) return null;
  const [gg, res] = await Promise.all([
    supabase.from("gbp_geogrids").select("id, search_term, scanned_at, state, agr, atgr, solv, grid_size, point_distance, distance_measure, ranks, image_url, public_url")
      .in("resource_id", resourceIds).order("scanned_at", { ascending: false }).limit(5000),
    supabase.from("integration_resources").select("id, display_name, metadata").in("id", resourceIds),
  ]);
  // tables missing (migration not applied) => render nothing rather than break the page
  const grids = (gg.error ? [] : gg.data ?? []) as Geogrid[];
  const resources = (res.data ?? []) as Resource[];

  /* ------------------------------------------------------------ geogrids */
  const latestByTerm = new Map<string, Geogrid>();
  for (const g of grids) if (g.state !== "error" && !latestByTerm.has(g.search_term)) latestByTerm.set(g.search_term, g);
  const historyByTerm = new Map<string, Geogrid[]>();
  for (const g of grids) historyByTerm.set(g.search_term, [...(historyByTerm.get(g.search_term) ?? []), g]);

  const bySolv = [...latestByTerm.values()].sort((a, b) => (num(b.solv) ?? -1) - (num(a.solv) ?? -1));

  return (
    <div className="mt-8 space-y-6">
      {/* Local rankings */}
      <section className={card} aria-labelledby="geo-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="geo-h" className="text-base font-semibold">Local rankings (geogrid)</h2>
          <span className="text-xs text-muted">Google Maps rank at each grid point · source: Local Brand Manager</span>
        </div>
        {latestByTerm.size === 0 ? <p className="text-sm text-muted">No geogrid scans stored yet.</p> : (
          <>
            <p className="mb-3 text-xs text-muted" title="AGR = average rank where the business appears · ATGR = average rank over all points (not found counts as 21) · SoLV = share of points in the top 3. Lower AGR/ATGR and higher SoLV are better.">
              AGR: average rank where you appear · ATGR: average over all points · SoLV: share of points in the top 3
            </p>
            <GeoCards initial={9} cards={[...latestByTerm.values()].map((g): GeoCard => {
              const hist = historyByTerm.get(g.search_term) ?? [];
              const prev = hist.find((h) => h.id !== g.id && h.state !== "error");
              return {
                id: g.id, term: g.search_term, ranks: g.ranks && g.ranks.length > 0 ? g.ranks : null, publicUrl: safeUrl(g.public_url), imageUrl: safeUrl(g.image_url),
                meta: `Scanned ${day(g.scanned_at)}${g.grid_size ? ` · ${g.grid_size}×${g.grid_size} grid, ${g.point_distance} ${g.distance_measure ?? ""} apart` : ""}`,
                stats: ([["AGR", g.agr, prev?.agr, false], ["ATGR", g.atgr, prev?.atgr, false], ["SoLV", g.solv, prev?.solv, true]] as const).map(([k, v, p, higher]) => {
                  const cur = num(v), before = num(p);
                  const better = cur != null && before != null && cur !== before ? (higher ? cur > before : cur < before) : null;
                  const f = (n: number) => (k === "SoLV" ? solvPct(n) : n.toFixed(1));
                  return { k, v: cur == null ? "—" : f(cur), delta: better == null ? null : { better, before: f(before!) } };
                }),
              };
            })} closer={
              <article className="flex flex-col rounded-lg border border-border p-3">
                <h3 className="font-semibold">Share of local voice by term</h3>
                <p className="text-xs text-muted">Latest scan per term, best first · {fmtInt(latestByTerm.size)} terms</p>
                <div className="relative mt-3 min-h-60 flex-1">
                  <ul className="absolute inset-0 space-y-2 overflow-y-auto pr-1 text-[13px]">
                    {bySolv.map((g) => (
                      <li key={g.id} title={`${g.search_term}: SoLV ${solvPct(g.solv)}, ATGR ${num(g.atgr)?.toFixed(1) ?? "—"}`}>
                        <div className="flex justify-between gap-3"><span className="truncate">{g.search_term}</span><span className="shrink-0 tabular-nums">{solvPct(g.solv)}</span></div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden><div className="h-full rounded-full bg-series" style={{ width: `${Math.max(0, Math.min(100, (num(g.solv) ?? 0) * 100))}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            } />
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-accent">Show all {fmtInt(grids.length)} scans (history)</summary>
              <div className="mt-2 max-h-[30rem] overflow-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead><tr className="text-left text-xs text-muted">{["Search term", "Scanned", "AGR", "ATGR", "SoLV", ""].map((h, i) => <th key={i} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {grids.map((g) => (
                      <tr key={g.id} className="border-t border-border">
                        <td className="px-2 py-1">{g.search_term}</td><td className="px-2 py-1">{day(g.scanned_at)}</td>
                        <td className="px-2 py-1 tabular-nums">{num(g.agr)?.toFixed(1) ?? "—"}</td><td className="px-2 py-1 tabular-nums">{num(g.atgr)?.toFixed(1) ?? "—"}</td>
                        <td className="px-2 py-1 tabular-nums">{solvPct(g.solv)}</td>
                        <td className="px-2 py-1">{safeUrl(g.public_url) && <a href={safeUrl(g.public_url)!} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">view</a>}{g.state === "error" && <span className="text-negative">scan failed</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      {/* Rank-tracking setup, legacy insights, reports (business information is in its own card) */}
      {resources.map((r) => {
        const md = r.metadata ?? {};
        const configs = (md.lbm_geogrid_configs ?? []) as Config[];
        const reports = (md.lbm_reports ?? []) as { name: string; created_at: string; periods: string[]; url: string }[];
        const legacy = (md.lbm_legacy_insights ?? []) as Record<string, unknown>[];
        if (!configs.length && !reports.length && !legacy.length) return null;
        return (
          <section key={r.id} className={card} aria-label={`${r.display_name} Local Brand Manager details`}>
            <h2 className="mb-3 text-base font-semibold">{r.display_name}: Local Brand Manager</h2>
            {legacy.length > 0 && (
              <div className="text-sm">
                <p className="mb-1 font-medium">Legacy Google insights (retired API)</p>
                <ul className="text-xs">{legacy.map((l, i) => <li key={i}>{String(l.timestamp)}: {Object.entries(l).filter(([k, v]) => k !== "timestamp" && v != null).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}</li>)}</ul>
              </div>
            )}
            {reports.length > 0 && (
              <div className="mt-6 text-sm">
                <p className="mb-1 font-medium">Local Brand Manager reports</p>
                <ul className="space-y-1">{reports.map((p, i) => (
                  <li key={i}>{safeUrl(p.url) ? <a href={safeUrl(p.url)!} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">{p.name}</a> : p.name}
                    <span className="text-xs text-muted"> · {p.periods.join(" vs ")} · {p.created_at}</span></li>
                ))}</ul>
              </div>
            )}
            {configs.length > 0 && (
              <div className="mt-6 text-sm">
                <p className="mb-1 font-medium">Rank-tracking schedule</p>
                {configs.map((c) => (
                  <div key={c.id} className="mb-2 rounded-lg bg-surface-muted p-2 text-xs">
                    <p>{c.period === "day_of_month" ? `Monthly on day ${c.month_day}` : c.period?.replace(/_/g, " ") ?? "Scheduled"}{c.hour != null ? ` at ${c.hour}:00` : ""} {c.time_zone ? `(${c.time_zone})` : ""} · next {c.scheduled_at ?? "—"}</p>
                    <p className="mt-1">Tracked terms: {c.search_terms.map((t) => `${t.text}${t.active ? "" : " (paused)"}${t.geogrids_count ? ` · ${t.geogrids_count} scans` : ""}`).join("; ")}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
