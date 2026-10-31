import { GeoCards, type GeoCard } from "./geo-cards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Star } from "lucide-react";
import { fmtInt, fmtPercent } from "@/lib/analytics/format";

type Review = { id: string; rating: number | null; text: string | null; reviewer_name: string | null; reply_text: string | null; reviewed_at: string | null };
type Geogrid = {
  id: string; search_term: string; scanned_at: string | null; state: string | null; agr: number | null; atgr: number | null; solv: number | null;
  grid_size: number | null; point_distance: number | null; distance_measure: string | null; ranks: (number | string)[][] | null;
  image_url: string | null; public_url: string | null;
};
type Keyword = { month: string; keyword: string; impressions: number | null; impressions_threshold: number | null };
type Resource = { id: string; display_name: string | null; metadata: Record<string, unknown> | null };
type Config = {
  id: string; period: string | null; month_day: number | null; hour: number | null; time_zone: string | null; scheduled_at: string | null;
  search_terms: { id: string; active: boolean; text: string; geogrids_count: number | null; processed_at: string | null }[];
};
type LbmLocation = {
  description?: string | null; additional_categories?: string[] | null; labels?: string[] | null; tags?: string[] | null; states?: string[];
  regular_hours?: { periods?: { open_day: string; open_time: string; close_time: string }[] } | null;
  service_area?: { places?: { place_infos?: { name: string }[] } } | null; store_code?: string | null; created_at?: string;
};

const card = "rounded-[10px] border border-border bg-surface p-4";
const num = (v: unknown) => (v == null ? null : Number(v));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
/** LBM reports SoLV as a fraction (0.93 = 93%). */
const solvPct = (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`);
const safeUrl = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : null);

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const hrs = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) + (m || 0) / 60; };

/** Opening hours as a week of bars on a 24-hour axis; each row prints its times, closed days say so. */
function HoursChart({ hours }: { hours: { open_day: string; open_time: string; close_time: string }[] }) {
  return (
    <div>
      <p className="mb-2 font-medium">Opening hours</p>
      <ul className="space-y-1.5 text-xs" aria-label="Opening hours">
        {DAYS.map((d) => {
          const list = hours.filter((h) => h.open_day === d);
          return (
            <li key={d} className="grid grid-cols-[2.25rem_minmax(0,1fr)_7rem] items-center gap-2">
              <span className="text-muted">{d.charAt(0) + d.slice(1, 3).toLowerCase()}</span>
              <span className="relative h-2.5 rounded-full bg-surface-muted" aria-hidden>
                {list.map((h, i) => {
                  const a = hrs(h.open_time), b = hrs(h.close_time) || 24;
                  return <span key={i} className="absolute inset-y-0 rounded-full bg-series" style={{ left: `${(a / 24) * 100}%`, width: `${(Math.max(0, (b > a ? b : 24) - a) / 24) * 100}%` }} />;
                })}
              </span>
              <span className="text-right tabular-nums text-secondary">{list.length ? list.map((h) => `${h.open_time}–${h.close_time}`).join(", ") : "Closed"}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 grid grid-cols-[2.25rem_minmax(0,1fr)_7rem] gap-2 text-[10px] text-faint" aria-hidden>
        <span /><span className="flex justify-between"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></span><span />
      </div>
    </div>
  );
}

/**
 * Everything Local Brand Manager stores beyond daily metrics: reviews, geogrid local-rank scans and
 * their schedule, every monthly search keyword, the full location record and LBM report links.
 */
export async function LbmSections({ supabase, resourceIds, range }: {
  supabase: SupabaseClient; resourceIds: string[]; range: { start: string; end: string };
}) {
  if (resourceIds.length === 0) return null;
  const [rv, gg, kw, res] = await Promise.all([
    supabase.from("gbp_reviews").select("id, rating, text, reviewer_name, reply_text, reviewed_at").in("resource_id", resourceIds)
      .order("reviewed_at", { ascending: false }).limit(5000),
    supabase.from("gbp_geogrids").select("id, search_term, scanned_at, state, agr, atgr, solv, grid_size, point_distance, distance_measure, ranks, image_url, public_url")
      .in("resource_id", resourceIds).order("scanned_at", { ascending: false }).limit(5000),
    supabase.from("gbp_keyword_metrics").select("month, keyword, impressions, impressions_threshold").in("resource_id", resourceIds)
      .order("month", { ascending: false }).limit(10000),
    supabase.from("integration_resources").select("id, display_name, metadata").in("id", resourceIds),
  ]);
  // tables missing (migration not applied) => render nothing rather than break the page
  const reviews = (rv.error ? [] : rv.data ?? []) as Review[];
  const grids = (gg.error ? [] : gg.data ?? []) as Geogrid[];
  const keywords = (kw.data ?? []) as Keyword[];
  const resources = (res.data ?? []) as Resource[];

  /* ------------------------------------------------------------ reviews */
  const rated = reviews.filter((r) => r.rating != null);
  const avg = rated.length ? rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length : null;
  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: rated.filter((r) => r.rating === s).length }));
  const inRange = reviews.filter((r) => r.reviewed_at && r.reviewed_at.slice(0, 10) >= range.start && r.reviewed_at.slice(0, 10) <= range.end);
  const replied = reviews.filter((r) => r.reply_text).length;
  // the 12 calendar months ending with the range's last month
  const end = new Date(`${range.end.slice(0, 7)}-01T00:00:00Z`);
  const perMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const list = reviews.filter((r) => r.reviewed_at?.startsWith(key));
    const stars = list.filter((r) => r.rating != null);
    return { key, label: d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }), n: list.length, avg: stars.length ? stars.reduce((a, r) => a + (r.rating ?? 0), 0) / stars.length : null };
  });
  const maxMonth = Math.max(1, ...perMonth.map((m) => m.n));

  /* ------------------------------------------------------------ geogrids */
  const latestByTerm = new Map<string, Geogrid>();
  for (const g of grids) if (g.state !== "error" && !latestByTerm.has(g.search_term)) latestByTerm.set(g.search_term, g);
  const historyByTerm = new Map<string, Geogrid[]>();
  for (const g of grids) historyByTerm.set(g.search_term, [...(historyByTerm.get(g.search_term) ?? []), g]);

  const bySolv = [...latestByTerm.values()].sort((a, b) => (num(b.solv) ?? -1) - (num(a.solv) ?? -1));

  /* ------------------------------------------------------------ keywords by month */
  const months = [...new Set(keywords.map((k) => k.month))].sort().reverse();

  return (
    <div className="mt-8 space-y-6">
      {/* Reviews */}
      <section className={card} aria-labelledby="reviews-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="reviews-h" className="text-base font-semibold">Google reviews</h2>
          <span className="text-xs text-muted">All reviews on record · source: Local Brand Manager</span>
        </div>
        {reviews.length === 0 ? <p className="text-sm text-muted">No reviews stored yet.</p> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs font-medium text-muted">Average rating</p>
                <p className="mt-1 flex items-center gap-1 text-[26px] font-semibold tracking-[-0.02em]">{avg?.toFixed(2) ?? "—"} <Star className="size-5 fill-[#D4970A] text-warn" aria-hidden /></p></div>
              <div><p className="text-xs font-medium text-muted">Total reviews</p><p className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{fmtInt(reviews.length)}</p></div>
              <div><p className="text-xs font-medium text-muted">New in this period</p><p className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{fmtInt(inRange.length)}</p>
                {inRange.length > 0 && <p className="text-xs text-muted">avg {(inRange.reduce((a, r) => a + (r.rating ?? 0), 0) / inRange.length).toFixed(1)}★</p>}</div>
              <div><p className="text-xs font-medium text-muted">Owner reply rate</p><p className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{fmtPercent(replied / reviews.length, 0)}</p>
                <p className="text-xs text-muted">{fmtInt(reviews.length - replied)} without a reply</p></div>
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-muted">Rating distribution</p>
                <ul className="space-y-2 text-sm" aria-label="Rating distribution">
                  {dist.map((d) => (
                    <li key={d.s} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 tabular-nums">{d.s}★</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full bg-warn" style={{ width: `${rated.length ? (d.n / rated.length) * 100 : 0}%` }} /></span>
                      <span className="w-16 shrink-0 text-right tabular-nums text-muted">{d.n} · {rated.length ? Math.round((d.n / rated.length) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted">New reviews per month · last 12 months (bar label = average rating)</p>
                <div className="flex h-32 items-end gap-1.5" role="img" aria-label={`New reviews per month: ${perMonth.map((m) => `${m.label} ${m.n}`).join(", ")}`}>
                  {perMonth.map((m) => (
                    <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.label}: ${m.n} review${m.n === 1 ? "" : "s"}${m.avg != null ? `, average ${m.avg.toFixed(1)}★` : ""}`}>
                      <span className="text-[11px] tabular-nums text-secondary">{m.n || ""}</span>
                      <span className="w-full max-w-8 rounded-t-[3px] bg-series" style={{ height: `${m.n ? Math.max(4, (m.n / maxMonth) * 100) : 2}%`, opacity: m.n ? 1 : 0.25 }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1.5 border-t border-hairline pt-1">
                  {perMonth.map((m) => <span key={m.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">{m.label.slice(0, 1)}{m.avg != null && <span className="hidden sm:inline"> {m.avg.toFixed(1)}</span>}</span>)}
                </div>
              </div>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-accent">Show all {fmtInt(reviews.length)} reviews</summary>
              <ul className="mt-3 max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{r.reviewer_name ?? "Google user"}</span>
                      <span className="text-xs text-muted">{r.rating != null ? `${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}` : ""} · {day(r.reviewed_at)}</span>
                    </div>
                    {r.text ? <p className="mt-1 whitespace-pre-line">{r.text}</p> : <p className="mt-1 text-muted">(rating only, no text)</p>}
                    {r.reply_text && <p className="mt-2 rounded-md bg-surface-muted p-2 text-xs"><span className="font-semibold">Owner reply: </span>{r.reply_text}</p>}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      {/* Local rankings */}
      <section className={card} aria-labelledby="geo-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="geo-h" className="text-base font-semibold">Local rankings (geogrid)</h2>
          <span className="text-xs text-muted">Google Maps rank at each grid point · source: Local Brand Manager</span>
        </div>
        {latestByTerm.size === 0 ? <p className="text-sm text-muted">No geogrid scans stored yet.</p> : (
          <>
            <p className="mb-3 text-xs text-muted">
              AGR = average rank where the business appears · ATGR = average rank over all points (not found counts as 21) · SoLV = share of points in the top 3.
              Lower AGR/ATGR and higher SoLV are better.
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

      {/* Every keyword, month by month */}
      {months.length > 0 && (
        <section className={card} aria-labelledby="kw-h">
          <h2 id="kw-h" className="mb-1 text-base font-semibold">All search keywords by month</h2>
          <p className="mb-3 text-xs text-muted">Every keyword Google reported for the profile. “&lt; N” means Google only gives a threshold for low counts.</p>
          <div className="space-y-2">
            {months.map((m, i) => {
              const list = keywords.filter((k) => k.month === m)
                .sort((a, b) => (b.impressions ?? b.impressions_threshold ?? 0) - (a.impressions ?? a.impressions_threshold ?? 0));
              return (
                <details key={m} open={i === 0}>
                  <summary className="cursor-pointer text-sm font-medium">{new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} · {fmtInt(list.length)} keywords</summary>
                  <ul className="mt-2 grid max-h-80 gap-x-6 overflow-y-auto text-sm sm:grid-cols-2">
                    {list.map((k) => (
                      <li key={k.keyword} className="flex justify-between gap-3 border-b border-border/60 py-1">
                        <span className="break-words">{k.keyword}</span>
                        <span className="shrink-0 tabular-nums text-muted">{k.impressions != null ? fmtInt(k.impressions) : `< ${fmtInt(k.impressions_threshold)}`}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {/* Rank-tracking setup, full location record, reports */}
      {resources.map((r) => {
        const md = r.metadata ?? {};
        const loc = (md.lbm_location ?? null) as LbmLocation | null;
        const configs = (md.lbm_geogrid_configs ?? []) as Config[];
        const reports = (md.lbm_reports ?? []) as { name: string; created_at: string; periods: string[]; url: string }[];
        const legacy = (md.lbm_legacy_insights ?? []) as Record<string, unknown>[];
        if (!loc && !configs.length && !reports.length) return null;
        const hours = loc?.regular_hours?.periods ?? [];
        const areas = loc?.service_area?.places?.place_infos ?? [];
        return (
          <section key={r.id} className={card} aria-label={`${r.display_name} details`}>
            <h2 className="mb-3 text-base font-semibold">{r.display_name}: profile details</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3 text-sm">
                {loc?.description && <p className="whitespace-pre-line">{loc.description}</p>}
                <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
                  {loc?.additional_categories?.length ? <><dt className="text-muted">More categories</dt><dd>{loc.additional_categories.join(", ")}</dd></> : null}
                  {loc?.states?.length ? <><dt className="text-muted">Profile status</dt><dd>{loc.states.filter((x) => !x.startsWith("can_")).join(", ").replace(/_/g, " ") || "—"}</dd></> : null}
                  {loc?.labels?.length ? <><dt className="text-muted">Labels</dt><dd>{loc.labels.join(", ")}</dd></> : null}
                  {loc?.store_code ? <><dt className="text-muted">Store code</dt><dd>{loc.store_code}</dd></> : null}
                  {areas.length ? <><dt className="text-muted">Service area</dt><dd>{areas.map((a) => a.name).join("; ")}</dd></> : null}
                </dl>
              </div>
              <div className="space-y-4 text-sm">
                {hours.length > 0 && <HoursChart hours={hours} />}
                {legacy.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium">Legacy Google insights (retired API)</p>
                    <ul className="text-xs">{legacy.map((l, i) => <li key={i}>{String(l.timestamp)}: {Object.entries(l).filter(([k, v]) => k !== "timestamp" && v != null).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}</li>)}</ul>
                  </div>
                )}
              </div>
            </div>
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
