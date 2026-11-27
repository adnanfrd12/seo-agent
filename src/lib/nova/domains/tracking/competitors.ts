import "server-only";
import { z } from "zod";
import { refreshCompetitorExtrasNow } from "@/app/(dashboard)/competitors/actions";
import { saveCompetitors, saveResearchTarget } from "@/app/(dashboard)/research-actions";
import { ACTIVE_DAYS } from "@/lib/activity";
import { getSettings } from "@/lib/dataforseo/budget";
import { DFS_NOT_CONFIGURED, dfsConfigured } from "@/lib/dataforseo/client";
import { COMP_SPECS, EXTRAS_MAX, loadCompetitors, MAX_TRACKED, pickTracked, type SnapshotRow } from "@/lib/dataforseo/competitors";
import { marketByCode, marketLabel } from "@/lib/dataforseo/locations";
import { loadRankSettings } from "@/lib/dataforseo/rank";
import { hostOf, SPECS } from "@/lib/dataforseo/research";
import { fromAction, json, plural, read, ToolError, write, type NovaTool } from "../../kit";
import { ACTIVE_NOTE, ageDays, cleanDomain, compact, dfsBudget, money, NO_TARGET, quoted, readTarget, round1, scheduleOff, uniq, type TargetInfo } from "./shared";

/** Competitors and the research target (competitors/actions.ts and research-actions.ts do the changes). */
const PATHS = ["/competitors", "/overview"];
// saveCompetitors() keeps at most 8 picks (the analysis uses the first MAX_TRACKED) and 50 removed domains
const MAX_PICKS = 8, MAX_REMOVED = 50;
// what one tracked competitor adds to the automatic analysis: a daily overview plus four weekly lists
const PER_DAY = COMP_SPECS.domain_overview.est;
const PER_WEEK = COMP_SPECS.kw_gap.est + COMP_SPECS.kw_shared.est + COMP_SPECS.comp_pages.est + COMP_SPECS.comp_links.est;
const weekly = (n: number) => n * (7 * PER_DAY + PER_WEEK);
// stored runs show about 3 s for a link history and 10 s for a top-pages list
const HISTORY_SECONDS = 3, PAGES_SECONDS = 10;

const bare = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

interface Picks { manual: string[]; excluded: string[]; mode: "auto" | "manual" }
interface Ops { add?: string[]; remove?: string[]; restore?: string[]; mode?: "auto" | "manual" }
/** The same moves as the page's Track / Remove / Restore buttons, applied to the current lists. */
export function apply(cur: Picks, ops: Ops): Picks {
  let manual = uniq(cur.manual.map(bare)), excluded = uniq(cur.excluded.map(bare));
  for (const d of ops.remove ?? []) { manual = manual.filter((m) => m !== d); if (!excluded.includes(d)) excluded.push(d); }
  for (const d of [...(ops.restore ?? []), ...(ops.add ?? [])]) { excluded = excluded.filter((e) => e !== d); if (!manual.includes(d)) manual.push(d); }
  return { manual, excluded: excluded.slice(-MAX_REMOVED), mode: ops.mode ?? cur.mode };
}
const picksOf = (t: TargetInfo): Picks => ({ manual: t.competitors, excluded: t.competitors_excluded, mode: t.competitor_mode });

/**
 * saveResearchTarget() rewrites the domain, market and competitor list with whatever it is given, and deletes ALL stored
 * data when the domain or market differs. It is only used for the automatic refresh switch, and only when the stored
 * values pass through it unchanged.
 */
export function roundTripProblem(t: TargetInfo): string | null {
  const domain = cleanDomain(t.domain);
  const market = marketByCode(t.location_code);
  const competitors = uniq(t.competitors.map((c) => hostOf(c)).filter((c): c is string => Boolean(c) && c !== domain)).slice(0, MAX_PICKS);
  const same = domain === t.domain && market?.lang === t.language_code && competitors.join() === t.competitors.join();
  return same ? null : "This can't be changed from the chat safely: saving it would also rewrite the stored website, market or competitor list, and a different website or market deletes the stored data. Change it on the Backlinks page instead.";
}

const domains = z.array(z.string().trim().min(3).max(253)).max(20).optional();

export const tools: NovaTool[] = [
  read({
    name: "get_competitor_tracking",
    description: "Competitor tracking: the research website, market and automatic refresh, mode, tracked / picked / removed competitors, discovered competitors with overlap, each site's latest visibility snapshot, threats, and when competitor links and pages were fetched.",
    schema: z.object({}),
    async run(ctx) {
      const [comp, target, { data: extras }] = await Promise.all([
        loadCompetitors(ctx.admin, ctx.client.id), readTarget(ctx.admin, ctx.client.id),
        ctx.admin.from("dfs_cache").select("endpoint, params, fetched_at").eq("client_id", ctx.client.id).in("endpoint", ["comp_history", "comp_pages"]).order("fetched_at", { ascending: false }).limit(60),
      ]);
      if (!target) throw new ToolError(NO_TARGET);
      const off = await scheduleOff(ctx.admin, ctx.client.id, target);
      const tracked = new Set(comp.tracked), removed = new Set(target.competitors_excluded.map(bare));
      const byDomain = new Map<string, SnapshotRow[]>();
      for (const s of comp.snapshots) byDomain.set(s.domain, [...(byDomain.get(s.domain) ?? []), s]);
      const sites = [...byDomain].map(([domain, list]) => {
        const l = [...list].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)), first = l[0], last = l.at(-1)!;
        return {
          self: last.is_self, traffic: last.traffic ?? 0,
          row: compact({
            site: last.is_self ? `${domain} (you)` : domain, status: last.is_self ? null : tracked.has(domain) ? "tracked" : "not tracked now",
            keywords: last.keywords, top10: last.top10, est_traffic: last.traffic == null ? null : Math.round(last.traffic), shared_keywords: last.shared_keywords, avg_position_shared: round1(last.avg_position),
            keyword_change: l.length > 1 && first.keywords != null && last.keywords != null ? last.keywords - first.keywords : null, since: l.length > 1 ? first.snapshot_date : null, as_of: last.snapshot_date,
          }),
        };
      }).sort((a, b) => Number(b.self) - Number(a.self) || b.traffic - a.traffic).map((s) => s.row);
      const at = (ep: string, d: string) => (extras ?? []).find((r) => r.endpoint === ep && String((r.params as { competitor?: string } | null)?.competitor ?? "") === d)?.fetched_at;
      const extraList = comp.tracked.slice(0, EXTRAS_MAX);
      return json(compact({
        website: target.domain, market: marketLabel(target.location_code),
        automatic_refresh: off ? `off: ${off}, so no scheduled DataForSEO jobs run (manual runs only)` : `on (scheduled DataForSEO jobs run for ${ACTIVE_NOTE})`,
        mode: target.competitor_mode === "manual" ? "manual: only your picks" : "auto: your picks plus the strongest overlapping sites",
        tracked: comp.tracked, max_tracked: MAX_TRACKED, your_picks: target.competitors, removed: target.competitors_excluded,
        cost_per_tracked_competitor: `about ${money(PER_DAY)} a day plus ${money(PER_WEEK)} a week in the automatic analysis (${money(weekly(1))} a week)`,
        latest_analysis: comp.latestAt, sites,
        discovered: comp.auto ? [...comp.auto.data].sort((a, b) => (b.shared ?? 0) - (a.shared ?? 0)).slice(0, 12).map((x) => compact({
          domain: x.domain, status: tracked.has(x.domain.toLowerCase()) ? "tracked" : removed.has(bare(x.domain)) ? "removed" : null,
          shared_keywords: x.shared, avg_position: round1(x.avg_position), keywords: x.keywords, est_traffic: x.traffic == null ? null : Math.round(x.traffic),
        })) : null,
        discovered_on: comp.auto?.fetchedAt.slice(0, 10),
        threats: comp.threats.slice(0, 5).map((t) => `${t.domain} ${t.kind}: ${t.keywordsFrom} → ${t.keywordsTo} keywords in ${Math.round(t.days)} days`),
        links_and_pages: extraList.length ? {
          competitors: Object.fromEntries(extraList.map((d) => [d, `link history ${at("comp_history", d)?.slice(0, 10) ?? "never"}, top pages ${at("comp_pages", d)?.slice(0, 10) ?? "never"}`])),
          refresh: "weekly by itself; refresh_competitor_links_pages fetches what is over a week old",
        } : null,
      }));
    },
    summary: () => "Read competitor tracking",
  }),

  write({
    name: "update_competitors",
    description: "Change which competitors are tracked: add domains, remove them (stops tracking and hides them from automatic picks; restorable), restore removed ones, or switch auto / manual mode. Free; the next daily analysis picks it up.",
    schema: z.object({
      add: domains.describe("domains to track, e.g. rival.com"),
      remove: domains.describe("domains to stop tracking and hide from automatic picks"),
      restore: domains.describe("removed domains to track again"),
      mode: z.enum(["auto", "manual"]).optional().describe("auto = your picks plus the strongest overlapping sites; manual = only your picks"),
    }),
    async prepare(ctx, a) {
      if (!(await dfsConfigured(ctx.client.id))) return { error: `${DFS_NOT_CONFIGURED} Until then competitors can't be changed.` };
      const [target, comp] = await Promise.all([readTarget(ctx.admin, ctx.client.id), loadCompetitors(ctx.admin, ctx.client.id)]);
      if (!target || !comp.target) return { error: NO_TARGET };
      const off = await scheduleOff(ctx.admin, ctx.client.id, target);
      const self = bare(target.domain);
      const bad: string[] = [];
      const norm = (list?: string[]) => uniq((list ?? []).map((raw) => { const d = cleanDomain(raw); if (!d) bad.push(raw); return d; }).filter((d): d is string => !!d));
      const add = norm(a.add), remove = norm(a.remove), restore = norm(a.restore);
      if (bad.length) return { error: `Not a domain: ${bad.map(quoted).join(", ")}. Use domains like rival.com.` };
      const own = [...add, ...remove, ...restore].filter((d) => d === self || d.endsWith(`.${self}`));
      if (own.length) return { error: `${own.join(", ")} is the client's own website, not a competitor.` };
      const clash = [...add, ...restore].filter((d) => remove.includes(d));
      if (clash.length) return { error: `${clash.join(", ")} can't be removed and tracked in the same change.` };

      const cur = picksOf(target);
      const excluded = new Set(cur.excluded.map(bare)), manual = new Set(cur.manual.map(bare));
      const notRemoved = restore.filter((d) => !excluded.has(d));
      if (notRemoved.length) return { error: `${notRemoved.join(", ")} ${notRemoved.length === 1 ? "isn't" : "aren't"} removed, so there is nothing to restore. Use add to track a competitor.` };
      const toAdd = add.filter((d) => !manual.has(d) || excluded.has(d)), alreadyPicked = add.filter((d) => !toAdd.includes(d));
      const toRemove = remove.filter((d) => !excluded.has(d)), alreadyRemoved = remove.filter((d) => excluded.has(d));
      const mode = a.mode && a.mode !== cur.mode ? a.mode : undefined;
      const skipped = [
        alreadyPicked.length ? `Already picked: ${alreadyPicked.join(", ")}.` : "",
        alreadyRemoved.length ? `Already removed: ${alreadyRemoved.join(", ")}.` : "",
        a.mode && !mode ? `The mode is already ${a.mode}.` : "",
      ].filter(Boolean);
      if (!toAdd.length && !toRemove.length && !restore.length && !mode) return { error: [...skipped, "Nothing to change."].join(" ") };

      const next = apply(cur, { add: toAdd, remove: toRemove, restore, mode });
      if (next.manual.length > MAX_PICKS) return { error: `At most ${MAX_PICKS} competitors can be picked; this would make ${next.manual.length}. Remove some first.` };
      const before = comp.tracked;
      const after = pickTracked({ ...comp.target, competitors: next.manual, competitors_excluded: next.excluded, competitor_mode: next.mode }, comp.auto?.data ?? []);
      const lines = [
        toAdd.length ? `Track: ${toAdd.join(", ")}` : "",
        toRemove.length ? `Remove: ${toRemove.join(", ")}. ${toRemove.length === 1 ? "It stops" : "They stop"} being tracked, automatic picks won't add ${toRemove.length === 1 ? "it" : "them"} back, and stored data is hidden (it comes back on restore).` : "",
        restore.length ? `Restore and track again: ${restore.join(", ")}` : "",
        mode ? `Mode: ${cur.mode} → ${mode} (${mode === "manual" ? "only your picks are analysed" : "your picks plus the strongest overlapping sites, up to " + MAX_TRACKED})` : "",
        `Tracked: ${before.join(", ") || "none"} → ${after.join(", ") || "none"}`,
        next.manual.length > MAX_TRACKED ? `Only the first ${MAX_TRACKED} of the ${next.manual.length} picks are analysed.` : "",
        after.length !== before.length ? `The automatic analysis costs about ${money(weekly(1))} a week per tracked competitor (${money(weekly(before.length))} → ${money(weekly(after.length))} a week, DataForSEO).` : "",
        toAdd.length || restore.length ? (off ? `The daily analysis doesn't run (${off}), so new competitors only get data when it is run by hand.` : "New competitors get data in the next daily analysis (07:30 UTC).") : "",
        ...skipped,
      ].filter(Boolean);
      const parts = [toAdd.length ? `track ${toAdd.length}` : "", toRemove.length ? `remove ${toRemove.length}` : "", restore.length ? `restore ${restore.length}` : "", mode ? `${mode} mode` : ""].filter(Boolean);
      const title = parts.length > 1 ? `Competitors: ${parts.join(", ")}`
        : toAdd.length ? (toAdd.length === 1 ? `Track ${toAdd[0]} as a competitor` : `Track ${toAdd.length} competitors`)
        : toRemove.length ? (toRemove.length === 1 ? `Remove competitor ${toRemove[0]}` : `Remove ${toRemove.length} competitors`)
        : restore.length ? (restore.length === 1 ? `Restore competitor ${restore[0]}` : `Restore ${restore.length} competitors`)
        : `Switch competitors to ${mode} mode`;
      const list = (l: string[]) => (l.length ? l : undefined);
      return { title, detail: lines.join("\n"), input: { add: list(toAdd), remove: list(toRemove), restore: list(restore), mode } };
    },
    async execute(x, a) {
      // applied to the lists as they are now, so a change made on the page meanwhile isn't overwritten
      const t = await readTarget(x.admin, x.client.id);
      if (!t) return { ok: false, message: NO_TARGET };
      const next = apply(picksOf(t), a);
      if (next.manual.length > MAX_PICKS) return { ok: false, message: `At most ${MAX_PICKS} competitors can be picked; this would make ${next.manual.length}.` };
      const r = await saveCompetitors({ mode: next.mode, competitors: next.manual.join(","), excluded: next.excluded });
      if (!r.ok) return { ok: false, message: r.error };
      const bits = [a.add?.length ? `tracking ${a.add.join(", ")}` : "", a.remove?.length ? `removed ${a.remove.join(", ")}` : "", a.restore?.length ? `restored ${a.restore.join(", ")}` : "", a.mode ? `${a.mode} mode` : ""].filter(Boolean);
      return { ok: true, message: `Competitors saved: ${bits.join("; ")}. The next daily analysis includes the change.`, paths: PATHS };
    },
  }),

  write({
    name: "refresh_competitor_links_pages",
    description: `Fetch monthly link history and top pages for the first ${EXTRAS_MAX} tracked competitors, plus the client's own link history, now (paid DataForSEO, about ${money(COMP_SPECS.comp_history.est + COMP_SPECS.comp_pages.est)} per competitor). Parts under a week old are reused.`,
    schema: z.object({}),
    async prepare(ctx) {
      if (!(await dfsConfigured(ctx.client.id))) return { error: DFS_NOT_CONFIGURED };
      const [target, comp, { data: rows }, budget] = await Promise.all([
        readTarget(ctx.admin, ctx.client.id), loadCompetitors(ctx.admin, ctx.client.id),
        ctx.admin.from("dfs_cache").select("endpoint, params, fetched_at").eq("client_id", ctx.client.id).in("endpoint", ["comp_history", "comp_pages"]),
        dfsBudget(ctx.admin, ctx.client.id),
      ]);
      if (!target) return { error: NO_TARGET };
      if (!comp.tracked.length) return { error: "No competitors are tracked yet." };
      const list = comp.tracked.slice(0, EXTRAS_MAX);
      // the ensure() freshness rule: a stored answer for that competitor under a week old is reused (the link history also restarts each month)
      const month = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 13); return d.toISOString().slice(0, 10); })();
      const fresh = (ep: string, d: string) => (rows ?? []).some((r) => {
        const p = (r.params ?? {}) as { competitor?: string; date_from?: string };
        return r.endpoint === ep && p.competitor === d && (ep !== "comp_history" || p.date_from === month) && ageDays(r.fetched_at as string) < 7;
      });
      const histories = list.filter((d) => !fresh("comp_history", d)), pages = list.filter((d) => !fresh("comp_pages", d));
      if (!histories.length && !pages.length) {
        return { error: `Link history and top pages for ${list.join(", ")} were fetched in the last week; nothing new would be fetched. They refresh weekly by themselves.` };
      }
      const est = SPECS.history.est + histories.length * COMP_SPECS.comp_history.est + pages.length * COMP_SPECS.comp_pages.est;
      if (budget.left < SPECS.history.est) return { error: budget.exhausted };
      return {
        title: `Fetch link history and top pages for ${list.join(", ")}`,
        detail: [
          `Monthly link history (13 months) and the top pages of ${plural(list.length, "competitor")}${comp.tracked.length > EXTRAS_MAX ? ` (the first ${EXTRAS_MAX} of ${comp.tracked.length} tracked)` : ""}, plus your own link history.`,
          `To fetch: ${[histories.length ? `link history for ${histories.join(", ")}` : "", pages.length ? `top pages for ${pages.join(", ")}` : ""].filter(Boolean).join("; ")}, and your own link history: about ${money(est)}. The rest is under a week old and reused.`,
          budget.line,
        ].join("\n"),
        expectSeconds: HISTORY_SECONDS * (1 + histories.length) + PAGES_SECONDS * pages.length + 3,
      };
    },
    async execute() {
      return fromAction(await refreshCompetitorExtrasNow(), "Competitor data updated.", ["/competitors"]);
    },
  }),

  write({
    name: "set_research_auto_refresh",
    description: "Turn the client's automatic research refresh on or off (scheduled rank checks, competitor analysis, backlink and keyword data, site audit, brand lookup). Changing the website or market isn't possible here because it deletes stored data; that is done on the Backlinks page.",
    schema: z.object({ auto_refresh: z.boolean() }),
    async prepare(ctx, a) {
      if (!(await dfsConfigured(ctx.client.id))) return { error: DFS_NOT_CONFIGURED };
      const t = await readTarget(ctx.admin, ctx.client.id);
      if (!t) return { error: NO_TARGET };
      if (t.auto_refresh === a.auto_refresh) return { error: `Automatic research refresh is already ${a.auto_refresh ? "on" : "off"}.` };
      const problem = roundTripProblem(t);
      if (problem) return { error: problem };
      const [{ schedule }, dfs] = await Promise.all([loadRankSettings(ctx.admin, ctx.client.id), getSettings(ctx.admin, { clientId: ctx.client.id })]);
      return {
        title: `Turn automatic research refresh ${a.auto_refresh ? "on" : "off"}`,
        detail: [
          `Automatic refresh for ${t.domain} (${marketLabel(t.location_code)}): ${t.auto_refresh ? "on" : "off"} → ${a.auto_refresh ? "on" : "off"}.`,
          a.auto_refresh
            ? `The scheduled DataForSEO jobs resume while the client is opened at least every ${ACTIVE_DAYS} days: rank checks (${schedule}), the daily competitor analysis, weekly backlink, keyword and link-change data, the weekly site audit and the brand lookup. They spend from the automatic share of the daily API cap.`
            : `The scheduled DataForSEO jobs stop for this client: rank checks, the daily competitor analysis, backlink, keyword and link-change data, the weekly site audit and the brand lookup. Stored data stays and "check now" runs still work. AI visibility questions are still asked weekly.`,
          a.auto_refresh && !dfs.autoRefresh ? "Automatic refresh is also off for all clients on the Integrations page, so nothing runs until that is switched on too." : "",
          "The website, market and competitors stay as they are.",
        ].filter(Boolean).join("\n"),
      };
    },
    async execute(x, a) {
      const t = await readTarget(x.admin, x.client.id);
      if (!t) return { ok: false, message: NO_TARGET };
      const problem = roundTripProblem(t);
      if (problem) return { ok: false, message: problem };
      const r = await saveResearchTarget({ domain: t.domain, location: t.location_code, autoRefresh: a.auto_refresh, competitors: t.competitors.join(", ") });
      return r.ok ? { ok: true, message: `Automatic research refresh is now ${a.auto_refresh ? "on" : "off"} for ${t.domain}.`, paths: ["/rank-tracking", "/competitors", "/backlinks", "/organic-keywords"] } : { ok: false, message: r.error };
    },
  }),
];
