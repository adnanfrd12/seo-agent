import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { activeClientIds } from "@/lib/activity";
import { generateAlerts } from "@/lib/alerts";
import { AUTO_SHARE, getSettings, spend } from "@/lib/dataforseo/budget";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { runCompetitorAnalysis } from "@/lib/dataforseo/competitors";
import { refreshCore, resolveTarget } from "@/lib/dataforseo/research";
import { serverEnv } from "@/lib/env";
import { loggedRun } from "@/lib/jobs/log";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

const STALE_DAYS = 7;
/** Share of the DAILY cap that daily competitor analysis may use before the weekly core refresh gets its turn. */
const COMPETITOR_SHARE = 0.35;

/**
 * Daily. Order of work, all inside the automatic budget (60% of the daily cap set on the Integrations page):
 *   1. competitor analysis for ACTIVE clients (opened in the last 14 days), oldest analysis first
 *   2. the cheap weekly core refresh (backlink summary, rank overview, ranked keywords) for stale clients
 *   3. alert detection for every client (stored data only, no paid calls)
 * Each paid call is skipped while its stored answer is fresh, so re-running this never spends twice.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const deadline = Date.now() + 270_000;
  try {
    const summary = await loggedRun(admin, "research", async () => {
      const out: Record<string, unknown> = {};
      const { data: clients } = await admin.from("clients").select("id, timezone");
      const ids = (clients ?? []).map((c) => c.id as string);

      if (dfsConfigured()) {
        const settings = await getSettings(admin);
        if (!settings.autoRefresh) {
          out.skipped = "Automatic refresh is turned off on the Integrations page";
        } else {
          const cap = settings.dailyBudget;
          const spentNow = async () => { try { return await spend(admin); } catch { return Infinity; } };
          if ((await spentNow()) === Infinity) {
            out.skipped = "spend tracking unavailable (apply the latest migrations)";
          } else {
            // 1. competitor analysis for active clients
            const active = await activeClientIds(admin);
            const { data: last } = await admin.from("competitor_snapshots").select("client_id, snapshot_date").eq("is_self", true).order("snapshot_date", { ascending: false }).limit(5000);
            const lastDay = new Map<string, string>();
            for (const r of last ?? []) if (!lastDay.has(r.client_id)) lastDay.set(r.client_id, r.snapshot_date);
            const today = new Date().toISOString().slice(0, 10);
            const queue = ids.filter((id) => active.has(id) && lastDay.get(id) !== today).sort((a, b) => (lastDay.get(a) ?? "").localeCompare(lastDay.get(b) ?? ""));
            const comp: { client: string; fetched: number; cost: number; note?: string }[] = [];
            let compStopped: string | null = null;
            for (const id of queue) {
              if (Date.now() > deadline) { compStopped = "time"; break; }
              if ((await spentNow()) >= cap * COMPETITOR_SHARE) { compStopped = "competitor budget"; break; }
              const target = await resolveTarget(admin, id);
              if (!target || !target.auto_refresh) continue;
              const rep = await runCompetitorAnalysis({ admin, clientId: id, source: "auto" }, target);
              comp.push({ client: id, fetched: rep.fetched, cost: Number(rep.cost.toFixed(4)), note: rep.errors[0] });
              if (rep.stoppedByBudget) { compStopped = "budget"; break; }
            }
            out.competitors = { analysed: comp.length, waiting: Math.max(0, queue.length - comp.length), stopped: compStopped, activeClients: active.size };

            // 2. weekly core refresh, stalest first
            const { data: cached } = await admin.from("dfs_cache").select("client_id, fetched_at").eq("endpoint", "summary");
            const lastCore = new Map((cached ?? []).map((r) => [r.client_id as string, Date.parse(r.fetched_at as string)]));
            const stale = ids.filter((id) => !lastCore.has(id) || Date.now() - lastCore.get(id)! > STALE_DAYS * 86_400_000).sort((a, b) => (lastCore.get(a) ?? 0) - (lastCore.get(b) ?? 0));
            let core = 0;
            let coreStopped: string | null = null;
            for (const id of stale) {
              if (Date.now() > deadline) { coreStopped = "time"; break; }
              if ((await spentNow()) >= cap * AUTO_SHARE) { coreStopped = "budget"; break; }
              const target = await resolveTarget(admin, id); // derives the domain from Bing / Search Console / Business Profile
              if (!target || !target.auto_refresh) continue;
              const rep = await refreshCore({ admin, clientId: id, source: "auto" }, target);
              core++;
              if (rep.stoppedByBudget) { coreStopped = "budget"; break; }
            }
            out.core = { refreshed: core, waiting: Math.max(0, stale.length - core), stopped: coreStopped };
            out.spentToday = Number((await spentNow()).toFixed(3));
          }
        }
      } else {
        out.skipped = "DataForSEO not configured";
      }

      // 3. alerts for every client (reads stored data only)
      let alerts = 0;
      for (const c of clients ?? []) {
        if (Date.now() > deadline + 20_000) break;
        try { alerts += await generateAlerts(admin, c.id as string, (c.timezone as string) ?? "UTC"); } catch { /* one client's failure never stops the rest */ }
      }
      out.alertsCreated = alerts;
      return out;
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Research run failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
