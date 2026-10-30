import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { activeClientIds } from "@/lib/activity";
import { runAiChecks, suggestPrompts } from "@/lib/ai/visibility";
import { AUTO_SHARE, BudgetError, getSettings, spend } from "@/lib/dataforseo/budget";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { runLighthouse, LH_EST } from "@/lib/dataforseo/lighthouse";
import { fetchProfile, GRID_POINT_EST, gridRivals, localIdentity, PROFILE_EST, REVIEWS_EST, runGrid, startReviews, type Grid, type Profile } from "@/lib/dataforseo/local";
import { loadCompetitors } from "@/lib/dataforseo/competitors";
import { ensure, refreshDeep, resolveTarget, SPECS, type Row } from "@/lib/dataforseo/research";
import { serverEnv } from "@/lib/env";
import { loggedRun } from "@/lib/jobs/log";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

const DAY = 86_400_000;
const GRID_EVERY_DAYS = 7, LH_EVERY_DAYS = 7, RIVAL_EVERY_DAYS = 7, DEEP_EVERY_DAYS = 14, GAP_EVERY_DAYS = 14;
const SEED_KEYWORDS = 10, SEED_PROMPTS = 5, MAX_GRID_KEYWORDS = 3;

/**
 * Daily, after the research run. Everything here used to need a button; it now runs on its own for
 * ACTIVE clients (opened in the last 14 days), inside the automatic share of the daily DataForSEO budget:
 *   0. starter setup (once per client): tracked keywords are topped up to 10 (desktop and mobile) and
 *      AI questions to 5, from the keywords the site already ranks for; removing one later is respected
 *   1. AI visibility (ChatGPT, Perplexity, Gemini via DataForSEO; Claude via the Anthropic key), weekly
 *   2. Google Maps rank grids for the keywords scanned before (or the business category), weekly
 *   3. Lighthouse on the home page and the top page, mobile and desktop, weekly
 *   4. Business Profiles and reviews of the competitors compared before (or "people also search"), weekly
 *   5. the backlink / top-pages deep dive, every two weeks
 *   6. link gap (sites linking to each tracked competitor but not to the client), every two weeks
 * Every step skips what is still fresh, so a re-run the same day spends nothing. Manual buttons still work.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const deadline = Date.now() + 270_000;
  try {
    const summary = await loggedRun(admin, "extras", async () => {
      const out: Record<string, unknown> = {};
      const active = [...(await activeClientIds(admin))];
      out.activeClients = active.length;
      const settings = dfsConfigured() ? await getSettings(admin) : null;
      const cap = settings?.dailyBudget ?? 0;
      const spentNow = async () => { try { return await spend(admin); } catch { return Infinity; } };
      const room = async (est: number) => settings?.autoRefresh !== false && (await spentNow()) + est <= cap * AUTO_SHARE;
      const age = (iso: string | null | undefined) => (iso ? Date.now() - Date.parse(iso) : Infinity);
      const latest = async (clientId: string, endpoint: string) => {
        const { data } = await admin.from("dfs_cache").select("params_hash, data, fetched_at").eq("client_id", clientId).eq("endpoint", endpoint).order("fetched_at", { ascending: false }).limit(50);
        return data ?? [];
      };

      // 0. starter setup (free, once per client: what someone removes later is not added back)
      let seededKw = 0, seededQ = 0;
      for (const id of active) {
        const target = await resolveTarget(admin, id);
        if (!target) continue;
        const { data: c } = await admin.from("clients").select("settings").eq("id", id).maybeSingle();
        const cs = (c?.settings ?? {}) as Record<string, unknown>;
        if (cs.tracking_seeded) continue;
        const ranked = ((await latest(id, "ranked_keywords"))[0]?.data ?? []) as Row[];
        // Search Console first: queries Google really shows the site for (top 30, most impressions), then DataForSEO's estimates
        const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
        const gsc = await admin.rpc("get_gsc_keywords", { p_client_id: id, p_start: start, p_end: end, p_search_type: "web", p_device: null, p_country: null, p_search: null, p_sort: "impressions", p_dir: "desc", p_limit: 100, p_offset: 0 });
        const seen = ((gsc.data as { rows?: { query: string; position: number | null; impressions: number }[] } | null)?.rows ?? [])
          .filter((q) => q.position != null && Number(q.position) <= 30 && q.query.length >= 4 && q.query.length <= 80 && !/["?]/.test(q.query)).map((q) => q.query.toLowerCase());
        if (!ranked.length && !seen.length) continue; // wait for the first keyword data
        const best = [...new Set([...seen, ...ranked.filter((k) => typeof k.keyword === "string" && Number(k.position) <= 50).sort((a, b) => Number(b.volume ?? 0) - Number(a.volume ?? 0)).map((k) => String(k.keyword))])];
        const { data: have } = await admin.from("rank_keywords").select("keyword").eq("client_id", id);
        const current = [...new Set((have ?? []).map((r) => r.keyword as string))];
        const keywords = [...current, ...best.filter((k) => !current.includes(k))].slice(0, Math.max(SEED_KEYWORDS, current.length));
        const rows = keywords.flatMap((keyword) => (["desktop", "mobile"] as const).map((device) => ({ client_id: id, keyword, device, location_code: target.location_code, language_code: target.language_code })));
        const { error: kErr, data: added } = await admin.from("rank_keywords").upsert(rows, { onConflict: "client_id,keyword,device,location_code", ignoreDuplicates: true }).select("id");
        if (!kErr) seededKw += added?.length ?? 0;
        const { count: qCount } = await admin.from("ai_prompts").select("id", { count: "exact", head: true }).eq("client_id", id);
        if ((qCount ?? 0) < SEED_PROMPTS) {
          const me = await localIdentity(admin, id);
          const prof = ((await latest(id, "gbp_profile")).find((r) => r.params_hash === "self")?.data ?? null) as Profile | null;
          const category = prof?.category ?? null;
          const local = category && me?.city ? [`Who are the best ${category.toLowerCase()}s in ${me.city}? Recommend specific businesses.`] : [];
          const { data: haveQ } = await admin.from("ai_prompts").select("prompt").eq("client_id", id);
          const existing = (haveQ ?? []).map((r) => String(r.prompt).toLowerCase());
          const prompts = [...local, ...suggestPrompts(best, [...local, ...existing], me?.city)].filter((q) => !existing.includes(q.toLowerCase())).slice(0, SEED_PROMPTS - (qCount ?? 0));
          if (prompts.length) {
            const { error, data: addedQ } = await admin.from("ai_prompts").upsert(prompts.map((prompt) => ({ client_id: id, prompt })), { onConflict: "client_id,prompt", ignoreDuplicates: true }).select("id");
            if (!error) seededQ += addedQ?.length ?? 0;
          }
        }
        await admin.from("clients").update({ settings: { ...cs, tracking_seeded: new Date().toISOString().slice(0, 10) } }).eq("id", id);
      }
      out.seeded = { keywords: seededKw, questions: seededQ };

      // 1. AI visibility (weekly per question; the DataForSEO assistants respect the automatic budget inside runAiChecks)
      if (process.env.ANTHROPIC_API_KEY) {
        // at most about two minutes per run, so the steps below always get their turn; the rest continues next run
        const aiDeadline = Math.min(deadline - 90_000, Date.now() + 120_000);
        let checked = 0, cost = 0;
        const errors: string[] = [];
        for (const id of active) {
          if (Date.now() > aiDeadline) break;
          const target = await resolveTarget(admin, id);
          if (!target) continue;
          const { data: s } = await admin.from("clients").select("settings").eq("id", id).maybeSingle();
          try {
            const r = await runAiChecks(admin, id, target.domain, { deadline: aiDeadline, source: "auto", search: (s?.settings as { ai_search?: boolean } | null)?.ai_search !== false });
            checked += r.checked; cost += r.cost; errors.push(...r.errors.slice(0, 2));
          } catch (e) { errors.push(e instanceof Error ? e.message : "failed"); }
        }
        out.aiVisibility = { questionsChecked: checked, cost: Number(cost.toFixed(3)), errors: [...new Set(errors)].slice(0, 3) };
      }

      if (!settings) { out.skipped = "DataForSEO not configured"; return out; }
      if (!settings.autoRefresh) { out.skipped = "Automatic refresh is turned off on the Integrations page"; return out; }

      // 2. map rank grids
      let grids = 0;
      let gridStopped: string | null = null;
      for (const id of active) {
        const me = await localIdentity(admin, id);
        if (!me || me.lat == null) continue;
        const rows = await latest(id, "maps_grid");
        const byKw = new Map<string, { g: Grid; at: string }>();
        for (const r of rows) { const g = r.data as Grid; if (!byKw.has(g.keyword)) byKw.set(g.keyword, { g, at: r.fetched_at as string }); }
        if (byKw.size < MAX_GRID_KEYWORDS) {
          const prof = ((await latest(id, "gbp_profile")).find((r) => r.params_hash === "self")?.data ?? null) as Profile | null;
          const ranked = ((await latest(id, "ranked_keywords"))[0]?.data ?? []) as Row[];
          const city = (me.city ?? "").toLowerCase();
          const localKw = ranked.map((k) => String(k.keyword ?? "")).filter((k) => k && (/near me/.test(k) || (city && k.includes(city))));
          for (const kw of [...(prof?.category ? [`${prof.category.toLowerCase()} near me`] : []), ...localKw]) {
            if (byKw.size >= MAX_GRID_KEYWORDS) break;
            if (!byKw.has(kw)) byKw.set(kw, { g: { keyword: kw, size: 3, spacingKm: 2 } as Grid, at: "" });
          }
        }
        for (const { g, at } of [...byKw.values()].slice(0, MAX_GRID_KEYWORDS)) {
          if (age(at || null) < (GRID_EVERY_DAYS - 0.5) * DAY) continue;
          if (Date.now() > deadline - 60_000) { gridStopped = "time"; break; }
          if (!(await room(g.size * g.size * GRID_POINT_EST))) { gridStopped = "budget"; break; }
          try { await runGrid({ admin, clientId: id, source: "auto" }, me, g.keyword, g.size === 5 ? 5 : 3, g.spacingKm || 2); grids++; }
          catch (e) { if (e instanceof BudgetError) { gridStopped = "budget"; break; } }
        }
        if (gridStopped) break;
      }
      out.grids = { scanned: grids, stopped: gridStopped };

      // 3. Lighthouse
      let lh = 0;
      for (const id of active) {
        if (Date.now() > deadline - 100_000) break;
        const runs = await latest(id, "lighthouse");
        if (age(runs[0]?.fetched_at as string | undefined) < (LH_EVERY_DAYS - 0.5) * DAY) continue;
        const target = await resolveTarget(admin, id);
        if (!target || !(await room(4 * LH_EST))) continue;
        const rel = ((await latest(id, "relevant_pages"))[0]?.data ?? []) as { page: string | null; traffic: number | null }[];
        const home = `https://${target.domain}/`;
        const topPage = rel.filter((r) => r.page).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).map((r) => (r.page!.startsWith("http") ? r.page! : `https://${r.page}`)).find((u) => u.replace(/\/$/, "") !== home.replace(/\/$/, ""));
        try { await runLighthouse({ admin, clientId: id, source: "auto" }, [home, ...(topPage ? [topPage] : [])], ["mobile", "desktop"]); lh++; } catch { /* next run */ }
      }
      out.lighthouse = { tested: lh };

      // 4. competitor Business Profiles and reviews
      let rivals = 0;
      for (const id of active) {
        if (Date.now() > deadline - 40_000) break;
        const profiles = await latest(id, "gbp_profile");
        const self = (profiles.find((r) => r.params_hash === "self")?.data ?? null) as Profile | null;
        const known = profiles.filter((r) => r.params_hash !== "self");
        // the ones compared before, else "people also search for", else the businesses that beat the client on its map grid
        const me = await localIdentity(admin, id);
        const also = (self?.alsoSearch ?? []).filter((a) => a.cid);
        const list = known.length
          ? known.map((r) => ({ key: r.params_hash as string, at: r.fetched_at as string, cid: (r.data as Profile | null)?.cid ?? null, name: String((r.data as Profile | null)?.title ?? "") }))
          : also.length
            ? also.slice(0, 3).map((a) => ({ key: `cid:${a.cid}`, at: "", cid: a.cid, name: a.title }))
            : gridRivals((await latest(id, "maps_grid")).map((r) => r.data as Grid), self?.title ?? me?.name ?? "").slice(0, 3)
              .map((g) => ({ key: g.cid ? `cid:${g.cid}` : `name:${g.name.toLowerCase()}`, at: "", cid: g.cid, name: g.name }));
        for (const r of list.slice(0, 3)) {
          if (age(r.at || null) < (RIVAL_EVERY_DAYS - 0.5) * DAY) continue;
          if (!(await room(PROFILE_EST + REVIEWS_EST / 2))) break;
          const ctx = { admin, clientId: id, source: "auto" as const };
          try {
            const p = await fetchProfile(ctx, { name: r.name, cid: r.cid }, r.key, me ?? undefined);
            if (p) await startReviews(ctx, { name: p.title ?? r.name, cid: p.cid ?? r.cid, placeId: p.placeId }, r.key, 50);
            rivals++;
          } catch (e) { if (e instanceof BudgetError) break; }
        }
      }
      out.rivalProfiles = { refreshed: rivals };

      // 5. deep dive (backlink lists, anchors, linked pages, competitors, top pages), every two weeks
      let deep = 0;
      for (const id of active) {
        if (Date.now() > deadline - 30_000) break;
        const last = await latest(id, "backlinks");
        if (age(last[0]?.fetched_at as string | undefined) < (DEEP_EVERY_DAYS - 0.5) * DAY) continue;
        const target = await resolveTarget(admin, id);
        if (!target || !target.auto_refresh || !(await room(0.35))) continue;
        const rep = await refreshDeep({ admin, clientId: id, source: "auto" }, target);
        deep++;
        if (rep.stoppedByBudget) break;
      }
      out.deepDive = { refreshed: deep };

      // 6. link gap against each tracked competitor
      let gaps = 0;
      for (const id of active) {
        if (Date.now() > deadline - 15_000) break;
        const target = await resolveTarget(admin, id);
        if (!target || !target.auto_refresh) continue;
        const comp = await loadCompetitors(admin, id);
        const { data: rows } = await admin.from("dfs_cache").select("params, fetched_at").eq("client_id", id).eq("endpoint", "link_gap");
        const done = new Map((rows ?? []).map((r) => [String((r.params as { competitor?: string }).competitor ?? ""), r.fetched_at as string]));
        for (const d of comp.tracked.slice(0, 3)) {
          if (age(done.get(d)) < (GAP_EVERY_DAYS - 0.5) * DAY) continue;
          if (!(await room(SPECS.link_gap.est))) break;
          try { await ensure({ admin, clientId: id, source: "auto" }, SPECS.link_gap, target, { extra: d }); gaps++; } catch (e) { if (e instanceof BudgetError) break; }
        }
      }
      out.linkGaps = { fetched: gaps };
      out.spentToday = Number((await spentNow()).toFixed(3));
      return out;
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Extras run failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
