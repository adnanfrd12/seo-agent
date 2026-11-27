import "server-only";
import { getSession } from "@/lib/analytics/client-context";
import { getSettings, orgSpendOrZero } from "./budget";
import { dfsBalance, dfsConfigured } from "./client";
import { loadCache, resolveTarget } from "./research";
import { memo } from "@/lib/memo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

/**
 * Everything a research page needs, read from storage only (no paid calls). Owners/admins without a
 * saved target get one derived for free from the client's Bing / Search Console / Business Profile site.
 */
export async function researchPage() {
  const { client, user, organization } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const configured = await dfsConfigured(client.id);
  const supabase = await createClient();
  const admin = createAdminClient();
  const owner = configured && canEdit;
  // the target must exist before the cache is read only the first time; afterwards everything loads in parallel
  const [, spent, settings, balance] = await Promise.all([
    owner ? resolveTarget(admin, client.id) : null,
    owner ? orgSpendOrZero(admin, { orgId: client.organizationId }) : 0,
    owner ? getSettings(admin, { orgId: client.organizationId }) : null,
    // the organization's DataForSEO account balance is for its owners and admins
    owner && organization?.id === client.organizationId && ["owner", "admin"].includes(organization.role) ? dfsBalance(client.id) : null,
  ]);
  // stored research changes only when a refresh runs (actions clear this), so repeat views reuse it briefly
  const cache = await memo(`research|${user.id}|${client.id}`, 120_000, () => loadCache(supabase, client.id));
  const budget = owner && settings ? { spent, cap: settings.dailyBudget, balance } : null;
  return { client, canEdit, configured, cache, budget };
}

export type ProfilePoint = { date: string; backlinks: number | null; referring_domains: number | null; rank: number | null; spam: number | null };

/** Monthly history from the API plus our own snapshots (which win on the same date), oldest first. */
export function profileSeries(history: Row[] | undefined, snapshots: Row[]): ProfilePoint[] {
  const map = new Map<string, ProfilePoint>();
  for (const h of history ?? []) {
    if (typeof h.date !== "string") continue;
    map.set(h.date, { date: h.date, backlinks: (h.backlinks as number) ?? null, referring_domains: (h.referring_domains as number) ?? null, rank: (h.rank as number) ?? null, spam: null });
  }
  for (const s of snapshots) {
    const d = String(s.snapshot_date);
    map.set(d, { date: d, backlinks: (s.backlinks as number) ?? null, referring_domains: (s.referring_domains as number) ?? null, rank: (s.rank as number) ?? null, spam: (s.spam_score as number) ?? null });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The point closest to (but not after) `daysAgo` days back, for "vs a month ago" comparisons. */
export function pointAgo(series: ProfilePoint[], daysAgo: number): ProfilePoint | null {
  const cutoff = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return [...series].reverse().find((p) => p.date <= cutoff) ?? null;
}
