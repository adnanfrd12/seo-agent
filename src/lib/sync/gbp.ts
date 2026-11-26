import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchDailyMetrics, fetchMonthlyKeywords, GbpApiError, getLocation, listPosts, listReviews, profileCompleteness,
  splitLocationName, type GbpAuth,
} from "@/lib/google/gbp";
import { dailyUpsertGroups } from "@/lib/google/gbp-parse";
import { GoogleAuthError } from "@/lib/google/oauth";
import { formatAddress, gbpAuth } from "@/lib/integrations/gbp-service";
import type { SyncResult } from "./types";

/** First day of every month overlapping [start, end] (YYYY-MM-01). */
export function months(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

async function upsert(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

/**
 * Imports everything the Business Profile APIs offer for one location:
 *  - Performance API daily metrics for [start, end] (all 12 DailyMetrics) and monthly search keywords
 *  - on non-backfill runs also: business information, every review (with the owner's reply) and every post
 * History is never lost: rows are only inserted or upserted on (resource, date) / (resource, month, keyword) /
 * (resource, remote id); a column Google didn't return is left as stored, and older periods outside the API's
 * window are never touched.
 */
export async function syncGbp(
  admin: SupabaseClient,
  t: { clientId: string; resourceId: string; connectionId: string; location: string },
  range: { start: string; end: string; full?: boolean },
): Promise<SyncResult> {
  const written: Record<string, number> = {};
  const failures: Record<string, string> = {};
  let auth: GbpAuth;
  try {
    auth = await gbpAuth(admin, t.connectionId);
  } catch (e) {
    return { written, failures: { auth: e instanceof Error ? e.message : "token refresh failed" }, authError: e };
  }
  const { account, location } = splitLocationName(t.location);
  const isAuth = (e: unknown) => e instanceof GoogleAuthError || (e instanceof GbpApiError && e.kind === "auth");
  // These can't be fixed by retrying: stop and surface the message instead of burning quota.
  const fatal = (e: unknown) => e instanceof GbpApiError && ["not_approved", "api_disabled", "permission"].includes(e.kind);
  const msg = (e: unknown, n = 400) => (e instanceof Error ? e.message : "failed").slice(0, n);
  const base = { client_id: t.clientId, resource_id: t.resourceId };
  const now = () => new Date().toISOString();

  try {
    const byDate = await fetchDailyMetrics(auth, location, range.start, range.end);
    let n = 0;
    for (const rows of dailyUpsertGroups(byDate, { ...base, updated_at: now() })) n += await upsert(admin, "gbp_daily_metrics", rows, "resource_id,metric_date");
    written.daily = n;
  } catch (e) {
    if (isAuth(e)) return { written, failures: { daily: msg(e) }, authError: e };
    failures.daily = msg(e);
    if (fatal(e)) return { written, failures, authError: null };
  }

  // keywords: month by month (a multi-month request returns one summed value per keyword)
  const [ey, em] = range.end.split("-").map(Number);
  const prevMonth = em === 1 ? `${ey - 1}-12-01` : `${ey}-${String(em - 1).padStart(2, "0")}-01`;
  const from = range.start < prevMonth ? range.start : prevMonth; // last month's keywords land a few days late
  let kw = 0;
  for (const month of months(from, range.end)) {
    try {
      const list = await fetchMonthlyKeywords(auth, location, month);
      const rows = [...new Map(list.map((k) => [k.keyword, k])).values()].map((k) => ({
        ...base, month, keyword: k.keyword, impressions: k.impressions, impressions_threshold: k.threshold, updated_at: now(),
      }));
      kw += await upsert(admin, "gbp_keyword_metrics", rows, "resource_id,month,keyword");
    } catch (e) {
      if (isAuth(e)) return { written, failures: { ...failures, keywords: msg(e) }, authError: e };
      failures[`keywords ${month.slice(0, 7)}`] = msg(e, 300);
      if (fatal(e) || (e instanceof GbpApiError && e.kind === "rate_limit")) break;
    }
  }
  written.keywords = kw;

  if (range.full === false) return { written, failures, authError: null };

  // business information (current state, kept on the resource like Local Brand Manager's location record)
  try {
    const loc = await getLocation(auth, location);
    const { data: res } = await admin.from("integration_resources").select("metadata").eq("id", t.resourceId).maybeSingle();
    const { error } = await admin.from("integration_resources").update({
      display_name: loc.title ?? undefined,
      metadata: {
        ...((res?.metadata ?? {}) as Record<string, unknown>), source: "google",
        address: formatAddress(loc), website: loc.websiteUri ?? null, phone: loc.phoneNumbers?.primaryPhone ?? null,
        category: loc.categories?.primaryCategory?.displayName ?? null, maps_uri: loc.metadata?.mapsUri ?? null,
        place_id: loc.metadata?.placeId ?? null, open_status: loc.openInfo?.status ?? null,
        google_location: loc, completeness: profileCompleteness(loc), google_location_at: now(),
      },
    }).eq("id", t.resourceId);
    if (error) throw new Error(`integration_resources: ${error.message}`);
    written.profile = 1;
  } catch (e) {
    if (isAuth(e)) return { written, failures: { ...failures, profile: msg(e) }, authError: e };
    failures.profile = msg(e, 300);
  }

  if (!account) {
    failures.reviews = "Reconnect Business Profile so reviews and posts can be read (the account is unknown).";
    return { written, failures, authError: null };
  }

  try {
    const { reviews } = await listReviews(auth, `${account}/${location}`);
    written.reviews = await upsert(admin, "gbp_reviews", reviews.map((r) => ({
      ...base, remote_id: r.remoteId, source: "google", rating: r.rating, text: r.text, reviewer_name: r.reviewer, reviewer_photo_url: r.photo,
      reply_text: r.reply, replied_at: r.repliedAt, reply_state: r.replyState, reviewed_at: r.createdAt, review_updated_at: r.updatedAt,
      raw: r.raw, updated_at: now(),
    })), "resource_id,remote_id");
  } catch (e) {
    if (isAuth(e)) return { written, failures: { ...failures, reviews: msg(e) }, authError: e };
    failures.reviews = msg(e, 300);
  }

  try {
    const posts = await listPosts(auth, `${account}/${location}`);
    const rows = posts.map((p) => ({
      ...base, remote_id: p.name, topic_type: p.topicType, state: p.state, summary: p.summary, language_code: p.languageCode,
      cta_type: p.ctaType, cta_url: p.ctaUrl, search_url: p.searchUrl, media: p.media, event: p.event, offer: p.offer,
      posted_at: p.createdAt, post_updated_at: p.updatedAt, raw: p.raw, updated_at: now(),
    }));
    // (no per-post metrics: see the note at the end of src/lib/google/gbp.ts)
    written.posts = await upsert(admin, "gbp_posts", rows, "resource_id,remote_id");
  } catch (e) {
    if (isAuth(e)) return { written, failures: { ...failures, posts: msg(e) }, authError: e };
    failures.posts = msg(e, 300);
  }
  return { written, failures, authError: null };
}
