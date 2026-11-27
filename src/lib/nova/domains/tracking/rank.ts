import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addRankKeywords, checkRanksNow, removeRankKeyword, setRankSchedule, toggleRankPin } from "@/app/(dashboard)/rank-tracking/actions";
import { DFS_NOT_CONFIGURED, dfsConfigured } from "@/lib/dataforseo/client";
import {
  loadRanks, loadRankSettings, MAX_RANK_KEYWORDS, movers, nextRankCheck, RANK_DEPTH, RANK_SCHEDULES, rankDueCutoff, rankEstimate, rankMonthlyCost, type RankRow, type RankSchedule,
} from "@/lib/dataforseo/rank";
import { bullets, fromAction, plural, read, ToolError, write, type ExecResult, type NovaTool } from "../../kit";
import { ACTIVE_NOTE, capJson, compact, dfsBudget, money, NO_TARGET, quoted, readTarget, scheduleOff, uniq } from "./shared";

/** Rank tracking: Google positions for chosen keywords (rank-tracking/actions.ts does the changes). */
const PATHS = ["/rank-tracking"];
const SCHEDULES = Object.keys(RANK_SCHEDULES) as [RankSchedule, ...RankSchedule[]];
// checkRanksNow() searches 4 keywords at a time and starts new batches for 50 s; stored checks show a batch takes about 14 s
const BATCH = 4, BATCH_SECONDS = 14, RUN_SECONDS = 50;
const BATCHES_PER_RUN = Math.ceil(RUN_SECONDS / BATCH_SECONDS);
const NOT_FOUND = "not found";
const MIGRATION = "Rank tracking isn't set up yet: database migration 20261030000020 is missing.";

/** The clean-up addRankKeywords() applies: split on new lines, commas and semicolons, lower case, single spaces. */
const keywordsOf = (list: string[]) => uniq(list.flatMap((s) => s.split(/[\n,;]+/)).map((k) => k.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean));

type KwRow = { id: string; keyword: string; device: string };
const label = (r: KwRow) => `${r.keyword} (${r.device})`;

async function keywordRows(admin: SupabaseClient, clientId: string): Promise<KwRow[]> {
  const { data, error } = await admin.from("rank_keywords").select("id, keyword, device").eq("client_id", clientId).order("created_at");
  if (error) throw new ToolError(MIGRATION);
  return (data ?? []) as KwRow[];
}

/** Tracked keywords by id, or by exact keyword (every device it is tracked on). */
function resolve(rows: KwRow[], refs: string[] | undefined): KwRow[] {
  const out: KwRow[] = [], missing: string[] = [];
  for (const ref of refs ?? []) {
    const byId = rows.find((r) => r.id === ref);
    const hits = byId ? [byId] : rows.filter((r) => r.keyword === keywordsOf([ref])[0]);
    if (!hits.length) missing.push(ref);
    for (const h of hits) if (!out.includes(h)) out.push(h);
  }
  if (missing.length) throw new ToolError(`Not tracked: ${missing.map(quoted).join(", ")}. Call get_rank_tracking for the tracked keywords and their ids.`);
  return out;
}

const shortUrl = (u: string | null, site: string) => {
  if (!u) return null;
  try { const x = new URL(u); const h = x.hostname.replace(/^www\./, ""); return h === site ? `${x.pathname}${x.search}` : `${h}${x.pathname}`; } catch { return u; }
};
const aiOverview = (r: RankRow, site: string) => !r.serp ? null
  : !r.serp.ai_overview.length ? "none" : r.serp.ai_overview.some((a) => (a.domain ?? "").replace(/^www\./, "").toLowerCase().endsWith(site)) ? "cited" : "not cited";

const refs = z.array(z.string().trim().min(1).max(200)).max(MAX_RANK_KEYWORDS * 2).optional();

export const tools: NovaTool[] = [
  read({
    name: "get_rank_tracking",
    description: "Tracked Google keywords with ids: position, change since the previous check (+ = up), best, ranking page, pin, next check, volume, map pack and AI Overview; plus the check schedule, what is due and what checks cost.",
    schema: z.object({
      filter: z.enum(["all", "pinned", "dropped", "gained", "top10", "page_2_3", "not_found", "not_checked"]).default("all"),
      search: z.string().trim().max(80).optional().describe("only keywords containing this text"),
    }),
    async run(ctx, a) {
      const [ranks, settings, target] = await Promise.all([loadRanks(ctx.admin, ctx.client.id), loadRankSettings(ctx.admin, ctx.client.id), readTarget(ctx.admin, ctx.client.id)]);
      if (!ranks.ok) throw new ToolError(MIGRATION);
      const off = await scheduleOff(ctx.admin, ctx.client.id, target);
      const site = (target?.domain ?? "").replace(/^www\./, "").toLowerCase();
      const all = ranks.rows, now = Date.now();
      const pinned = new Set(settings.pinned.filter((id) => all.some((r) => r.id === id)));
      const cutoff = rankDueCutoff(settings.days, now);
      const due = all.filter((r) => !r.checkedOn || r.checkedOn <= cutoff).length;
      const next = new Map(all.map((r) => [r.id, nextRankCheck(r.checkedOn, settings.days, now)]));
      const soonest = [...next.values()].sort()[0];
      const checked = all.filter((r) => r.checkedOn), found = checked.filter((r) => r.position !== null);
      const pos = (r: RankRow) => r.position as number;
      const { dropped, gained } = movers(all);
      const keep: Record<typeof a.filter, (r: RankRow) => boolean> = {
        all: () => true, pinned: (r) => pinned.has(r.id), dropped: (r) => dropped.includes(r), gained: (r) => gained.includes(r),
        top10: (r) => r.position !== null && r.position <= 10, page_2_3: (r) => r.position !== null && r.position >= 11 && r.position <= 30,
        not_found: (r) => !!r.checkedOn && r.position === null, not_checked: (r) => !r.checkedOn,
      };
      const term = a.search?.toLowerCase();
      const rows = all.filter((r) => keep[a.filter](r) && (!term || r.keyword.includes(term)))
        .sort((x, y) => Number(pinned.has(y.id)) - Number(pinned.has(x.id)) || (x.position ?? 1e9) - (y.position ?? 1e9));
      const base = compact({
        website: target?.domain, tracked: all.length, limit: MAX_RANK_KEYWORDS, schedule: settings.schedule,
        automatic_checks: off ? `none: ${off}, so only check_rankings_now runs` : `daily job at 07:30 UTC re-checks keywords due on the schedule, for ${ACTIVE_NOTE}`,
        last_checked: ranks.lastChecked, next_automatic_check: soonest && !off ? `${soonest.slice(0, 16).replace("T", " ")} UTC` : null, due_now: due,
        check_now_cost: all.length ? compact({ due: due ? money(rankEstimate(due)) : null, all: money(rankEstimate(all.length)) }) : null,
        monthly_cost_by_schedule: all.length ? Object.fromEntries(SCHEDULES.map((s) => [s, money(rankMonthlyCost(all.length, RANK_SCHEDULES[s]))])) : null,
        totals: checked.length ? compact({
          checked: checked.length, top3: found.filter((r) => pos(r) <= 3).length, top10: found.filter((r) => pos(r) <= 10).length, not_in_top_100: checked.length - found.length,
          average_position: found.length ? Number((found.reduce((s, r) => s + pos(r), 0) / found.length).toFixed(1)) : null,
          improved: all.filter((r) => (r.change ?? 0) > 0).length, declined: all.filter((r) => (r.change ?? 0) < 0).length, big_drops: dropped.length, big_gains: gained.length,
        }) : null,
        showing: `${a.filter}${a.search ? ` containing “${a.search}”` : ""}: ${rows.length}`,
        fields: `position = Google organic place (1 = first; "${NOT_FOUND}" = not in the top ${RANK_DEPTH}); previous and change (+ = up) only when it moved; checked / next_check only when they differ from last_checked / next_automatic_check; map_pack and ai_overview only when Google showed one`,
      });
      const soonestDay = soonest?.slice(0, 10);
      const list = rows.map((r) => {
        const ai = aiOverview(r, site), nextDay = next.get(r.id)?.slice(0, 10);
        return compact({
          id: r.id, keyword: r.keyword, device: r.device, pinned: pinned.has(r.id) || null,
          position: r.checkedOn ? (r.position ?? NOT_FOUND) : "not checked yet", previous: r.change ? (r.previous ?? NOT_FOUND) : null, change: r.change || null,
          best: r.best, page: shortUrl(r.url, site), checked: r.checkedOn !== ranks.lastChecked ? r.checkedOn : null, next_check: !off && nextDay !== soonestDay ? nextDay : null,
          volume: r.volume, kd: r.difficulty, map_pack: r.serp ? (r.pack ?? (r.serp.local_pack.length ? "not in pack" : null)) : null, ai_overview: ai === "none" ? null : ai,
        });
      });
      return capJson(base, "keywords", list);
    },
    summary: (a) => (a.filter === "all" && !a.search ? "Read tracked keywords" : `Read tracked keywords (${a.search ? `“${a.search}”` : a.filter.replace(/_/g, " ")})`),
  }),

  write({
    name: "update_rank_tracking",
    description: "Change rank tracking in one go: add keywords (desktop, mobile or both), stop tracking keywords, pin or unpin them, and set the automatic re-check schedule. Free; new keywords get positions at the next check.",
    schema: z.object({
      add: z.array(z.string().trim().min(2).max(300)).max(MAX_RANK_KEYWORDS).optional().describe("keywords to start tracking"),
      device: z.enum(["desktop", "mobile", "both"]).default("desktop").describe("device for the added keywords"),
      remove: refs.describe("keyword ids (or exact keywords) to stop tracking"),
      pin: refs.describe("keyword ids (or exact keywords) to pin to the top"),
      unpin: refs,
      schedule: z.enum(SCHEDULES).optional().describe("how often positions are re-checked automatically"),
    }),
    async prepare(ctx, a) {
      const [rows, settings, off] = await Promise.all([
        keywordRows(ctx.admin, ctx.client.id), loadRankSettings(ctx.admin, ctx.client.id), readTarget(ctx.admin, ctx.client.id).then((t) => scheduleOff(ctx.admin, ctx.client.id, t)),
      ]);
      const removing = resolve(rows, a.remove), pinning = resolve(rows, a.pin), unpinning = resolve(rows, a.unpin);
      const overlap = (x: KwRow[], y: KwRow[]) => x.filter((r) => y.includes(r)).map(label);
      const pinGone = [...overlap(pinning, removing), ...overlap(unpinning, removing)];
      if (pinGone.length) return { error: `Can't pin or unpin a keyword that is being removed: ${pinGone.join(", ")}.` };
      if (overlap(pinning, unpinning).length) return { error: `Pin or unpin, not both: ${overlap(pinning, unpinning).join(", ")}.` };

      const words = keywordsOf(a.add ?? []);
      const bad = words.filter((k) => k.length < 2 || k.length > 120);
      if (bad.length) return { error: `Keywords must be 2-120 characters: ${bad.map(quoted).join(", ")}.` };
      const devices = a.device === "both" ? ["desktop", "mobile"] : [a.device];
      const remaining = rows.filter((r) => !removing.includes(r));
      const has = new Set(remaining.map((r) => `${r.keyword}|${r.device}`));
      const pairs = words.flatMap((k) => devices.filter((d) => !has.has(`${k}|${d}`)).map((d) => ({ k, d })));
      const readded = pairs.filter((p) => removing.some((r) => r.keyword === p.k && r.device === p.d)).map((p) => `${p.k} (${p.d})`);
      if (readded.length) return { error: `${readded.join(", ")} would be removed and added again on the same device, which deletes its history. Leave it out of one of the lists.` };
      const adding = uniq(pairs.map((p) => p.k)), already = words.filter((k) => !adding.includes(k));
      const room = MAX_RANK_KEYWORDS - remaining.length;
      if (pairs.length > room) return { error: `Only ${room} more keyword/device pairs fit (the limit is ${MAX_RANK_KEYWORDS}); this would add ${pairs.length}. Remove some first or add fewer.` };

      const pinnedNow = new Set(settings.pinned);
      const toPin = pinning.filter((r) => !pinnedNow.has(r.id)), toUnpin = unpinning.filter((r) => pinnedNow.has(r.id));
      const schedule = a.schedule && a.schedule !== settings.schedule ? a.schedule : undefined;
      const skipped = [
        already.length ? `Already tracked, skipped: ${already.map(quoted).join(", ")}.` : "",
        pinning.length > toPin.length ? `Already pinned: ${pinning.filter((r) => pinnedNow.has(r.id)).map(label).join(", ")}.` : "",
        unpinning.length > toUnpin.length ? `Not pinned: ${unpinning.filter((r) => !pinnedNow.has(r.id)).map(label).join(", ")}.` : "",
        a.schedule && !schedule ? `The schedule is already ${a.schedule}.` : "",
      ].filter(Boolean);
      if (!pairs.length && !removing.length && !toPin.length && !toUnpin.length && !schedule) return { error: [...skipped, "Nothing to change."].join(" ") };

      const after = remaining.length + pairs.length;
      const lines: string[] = [];
      if (pairs.length) {
        lines.push(`Add ${plural(adding.length, "keyword")} on ${a.device === "both" ? "desktop and mobile" : a.device}:`, bullets(a.device === "both" ? pairs.map((p) => `${p.k} (${p.d})`) : adding));
        lines.push(`Free to add. ${off ? `Automatic checks don't run (${off}), so first positions come with a rank check now` : `First positions come with the next automatic check (${schedule ?? settings.schedule}) or a rank check now`} (about ${money(rankEstimate(pairs.length))} for these).`);
      }
      if (removing.length) lines.push(`Stop tracking ${plural(removing.length, "keyword")}:`, bullets(removing.map(label)), "Their position history is deleted too. This can't be undone.");
      if (toPin.length) lines.push(`Pin to the top: ${toPin.map(label).join(", ")}`);
      if (toUnpin.length) lines.push(`Unpin: ${toUnpin.map(label).join(", ")}`);
      if (schedule) lines.push(`Automatic checks: ${settings.schedule} → ${schedule} (about ${money(rankMonthlyCost(after, settings.days))} → ${money(rankMonthlyCost(after, RANK_SCHEDULES[schedule]))} a month in DataForSEO searches for ${plural(after, "keyword")}).${off ? ` They don't run now (${off}); the schedule applies once they do.` : ""}`);
      else if (pairs.length || removing.length) lines.push(`Checking ${plural(after, "keyword")} ${settings.schedule} costs about ${money(rankMonthlyCost(after, settings.days))} a month.`);
      lines.push(...skipped);

      const parts = [pairs.length ? `add ${plural(adding.length, "keyword")}` : "", removing.length ? `remove ${removing.length}` : "", toPin.length ? `pin ${toPin.length}` : "", toUnpin.length ? `unpin ${toUnpin.length}` : "", schedule ? `check ${schedule}` : ""].filter(Boolean);
      const title = parts.length > 1 ? `Rank tracking: ${parts.join(", ")}`
        : pairs.length ? `Add ${plural(adding.length, "keyword")} to rank tracking`
        : removing.length ? (removing.length === 1 ? `Stop tracking “${removing[0].keyword}” (${removing[0].device})` : `Stop tracking ${removing.length} keywords`)
        : toPin.length ? (toPin.length === 1 ? `Pin “${toPin[0].keyword}” (${toPin[0].device})` : `Pin ${toPin.length} keywords`)
        : toUnpin.length ? (toUnpin.length === 1 ? `Unpin “${toUnpin[0].keyword}” (${toUnpin[0].device})` : `Unpin ${toUnpin.length} keywords`)
        : `Check rankings ${schedule} instead of ${settings.schedule}`;
      const ids = (l: KwRow[]) => (l.length ? l.map((r) => r.id) : undefined);
      return {
        title, detail: lines.join("\n"),
        input: { add: adding.length ? adding : undefined, device: a.device, remove: ids(removing), pin: ids(toPin), unpin: ids(toUnpin), schedule },
      };
    },
    async execute(x, a): Promise<ExecResult> {
      const done: string[] = [], failed: string[] = [];
      const note = (r: { ok: true; message: string } | { ok: false; error: string }) => (r.ok ? done.push(r.message) : failed.push(r.error));
      if (a.remove?.length) {
        const { data } = await x.admin.from("rank_keywords").select("id, keyword, device").eq("client_id", x.client.id).in("id", a.remove);
        const gone: string[] = [];
        for (const r of (data ?? []) as KwRow[]) {
          const res = await removeRankKeyword(r.id);
          if (res.ok) gone.push(label(r)); else failed.push(`${label(r)}: ${res.error}`);
        }
        if (gone.length) done.push(`Stopped tracking ${gone.join(", ")}.`);
      }
      if (a.add?.length) {
        // one call per device, with only the pairs still missing, so the action's room check counts exactly what is added
        const has = new Set((await keywordRows(x.admin, x.client.id)).map((r) => `${r.keyword}|${r.device}`));
        let added = 0;
        for (const d of a.device === "both" ? (["desktop", "mobile"] as const) : [a.device]) {
          const list = a.add.filter((k) => !has.has(`${k}|${d}`));
          if (!list.length) continue;
          const res = await addRankKeywords(list.join("\n"), d);
          if (!res.ok) { failed.push(res.error); continue; }
          added += list.length;
          done.push(`Added ${list.map(quoted).join(", ")} (${d})${/limit/.test(res.message) ? `, until the ${MAX_RANK_KEYWORDS}-keyword limit was reached` : ""}.`);
        }
        if (added) done.push(`First positions come with the next automatic check or a rank check now (about ${money(rankEstimate(added))}).`);
      }
      if (a.pin?.length || a.unpin?.length) {
        // toggleRankPin flips the pin, so only call it where the state still differs
        const { pinned } = await loadRankSettings(x.admin, x.client.id);
        for (const id of a.pin ?? []) if (!pinned.includes(id)) note(await toggleRankPin(id));
        for (const id of a.unpin ?? []) if (pinned.includes(id)) note(await toggleRankPin(id));
      }
      if (a.schedule) note(await setRankSchedule(a.schedule));
      if (!done.length && !failed.length) return { ok: true, message: "Nothing needed changing: it was already done.", paths: PATHS };
      return { ok: !failed.length, message: [...done, ...failed.map((f) => `Not done: ${f}`)].join(" "), paths: PATHS };
    },
  }),

  write({
    name: "check_rankings_now",
    description: "Look up today's Google positions for the tracked keywords now (paid DataForSEO, about $0.0155 per keyword). Only keywords due on the schedule, unless recheck_all.",
    schema: z.object({ recheck_all: z.boolean().default(false).describe("also re-check keywords checked recently") }),
    async prepare(ctx, a) {
      if (!(await dfsConfigured(ctx.client.id))) return { error: `${DFS_NOT_CONFIGURED} Until then rankings can't be checked.` };
      const target = await readTarget(ctx.admin, ctx.client.id);
      if (!target) return { error: NO_TARGET };
      // the same selection runRankChecks() makes
      const [{ data: kws, error }, { data: last }, settings, budget] = await Promise.all([
        ctx.admin.from("rank_keywords").select("id, metrics").eq("client_id", ctx.client.id).order("created_at").limit(MAX_RANK_KEYWORDS),
        ctx.admin.from("rank_checks").select("keyword_id, checked_on").eq("client_id", ctx.client.id).order("checked_on", { ascending: false }).limit(2000),
        loadRankSettings(ctx.admin, ctx.client.id), dfsBudget(ctx.admin, ctx.client.id),
      ]);
      if (error) return { error: MIGRATION };
      const list = (kws ?? []) as { id: string; metrics?: { at?: string } | null }[];
      if (!list.length) return { error: "No keywords are tracked yet. Add some first." };
      const lastOn = new Map<string, string>();
      for (const r of last ?? []) if (!lastOn.has(r.keyword_id as string)) lastOn.set(r.keyword_id as string, r.checked_on as string);
      const cutoff = rankDueCutoff(settings.days);
      const due = list.filter((k) => { const d = lastOn.get(k.id); return !d || d <= cutoff; }).length;
      const n = a.recheck_all ? list.length : due;
      const latest = [...lastOn.values()].sort().at(-1);
      if (!n) return { error: `All ${list.length} keywords were checked within the ${settings.schedule} schedule (latest ${latest}). Nothing is due; set recheck_all to check them all again (about ${money(rankEstimate(list.length))}).` };
      if (budget.left < rankEstimate(1)) return { error: budget.exhausted };
      const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const staleMetrics = list.some((k) => !k.metrics?.at || k.metrics.at < monthAgo);
      const perRun = BATCHES_PER_RUN * BATCH, batches = Math.ceil(n / BATCH);
      return {
        title: a.recheck_all ? `Re-check all ${n} tracked keywords now` : `Check ${plural(n, "due keyword")} now`,
        detail: [
          `A live Google search per keyword (top ${RANK_DEPTH} results, ${money(rankEstimate(1))} each): up to ${money(rankEstimate(n))} for ${plural(n, "keyword")}${staleMetrics ? ", plus about $0.02 to refresh search volume and difficulty" : ""}.`,
          !a.recheck_all && list.length > n ? `${plural(list.length - n, "keyword")} checked within the ${settings.schedule} schedule ${list.length - n === 1 ? "is" : "are"} skipped.` : "",
          `Searches run ${BATCH} at a time for about a minute${n > perRun ? `: about ${perRun} keywords finish in one run, so run it again without recheck_all to continue with the rest` : ""}.`,
          budget.line,
          budget.left < rankEstimate(n) ? `Today's remaining limit (${money(budget.left)}) covers about ${Math.floor(budget.left / rankEstimate(1))} of them.` : "",
        ].filter(Boolean).join("\n"),
        expectSeconds: Math.min(batches, BATCHES_PER_RUN) * BATCH_SECONDS + (staleMetrics ? 5 : 0) + 3,
      };
    },
    async execute(_x, a) {
      return fromAction(await checkRanksNow(a.recheck_all), "Rankings checked.", PATHS);
    },
  }),
];
