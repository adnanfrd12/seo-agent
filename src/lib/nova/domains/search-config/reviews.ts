import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientSpendOrZero, getSettings, orgSpendOrZero, PER_CLIENT_SHARE } from "@/lib/dataforseo/budget";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { pollReviews, REVIEWS_EST } from "@/lib/dataforseo/local";
import { CRAWL_EST, CRAWLED, DISCOVERY_EST, DISCOVERY_EVERY_DAYS } from "@/lib/reviews/listings";
import { FETCHABLE, loadPlatformReviews, PLATFORM_EST, PLATFORMS, pollPlatforms, type PlatformKey, type PlatformView } from "@/lib/reviews/platforms";

/**
 * Reviews on every platform (the Reviews page): listing links (clients.settings.review_profiles; saved links win over
 * the ones found automatically and the defaults), what each platform shows, and what a refresh costs.
 */
export const PLATFORM_KEYS = PLATFORMS.map((p) => p.key) as [PlatformKey, ...PlatformKey[]];
export const labelOf = (k: string) => PLATFORMS.find((p) => p.key === k)?.label ?? k;
const STARLESS = new Set<string>(["nextdoor"]);

/** Checks one listing link the way the Reviews page saves it (saveProfiles), without saving. */
export function checkLink(platform: PlatformKey, raw: string): { url: string } | { error: string } {
  const p = PLATFORMS.find((x) => x.key === platform)!;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error: `${p.label}: that isn't a valid link.` }; }
  if (!p.host.test(u.hostname.toLowerCase().replace(/^www\./, ""))) return { error: `${p.label}: the link should be on ${p.example.split("/")[2]} (e.g. ${p.example}).` };
  return { url: u.toString().slice(0, 500) };
}

/** Where a platform's link comes from. */
export function linkSource(v: PlatformView, saved: Partial<Record<PlatformKey, string>>) {
  return saved[v.platform] ? "saved" : v.found ? "found automatically" : v.url ? "default" : "none";
}

function status(v: PlatformView) {
  if (v.access === "credentials") return v.url ? "link saved; needs the client's credentials to read reviews" : "needs credentials";
  if (v.access === "none") return v.url ? "link only (no public reviews API)" : "no public reviews API";
  if (v.status === "pending") return "collecting now";
  if (v.via === "google") return `rating as shown in Google search${v.status === "failed" && v.error ? ` (${v.error})` : ""}`;
  if (v.status === "failed") return v.error ?? "last collection failed";
  if (v.source === "live") return v.total === 0 || (v.total == null && !v.reviews.length) ? "no reviews found" : "read";
  if (v.url) return "not read yet";
  return v.searched ? "not found by the name / phone search" : "no listing link";
}

/** Platforms, summary numbers and the latest reviews. Collects review collections that finished (free), as the Reviews page does. */
export async function reviewsView(admin: SupabaseClient, clientId: string) {
  let loaded = await loadPlatformReviews(admin, admin, clientId);
  let collected = 0;
  if (loaded.views.some((v) => v.status === "pending") && (await dfsConfigured(clientId))) {
    const [a, b] = await Promise.all([pollReviews(admin, clientId).catch(() => ({ done: 0 })), pollPlatforms(admin, clientId).catch(() => ({ done: 0 }))]);
    collected = a.done + b.done;
    if (collected) loaded = await loadPlatformReviews(admin, admin, clientId);
  }
  const { saved, views, discovery } = loaded;
  const live = views.filter((v) => v.source === "live" && ((v.total ?? 0) > 0 || v.reviews.length > 0 || (v.faves ?? 0) > 0));
  const starred = live.filter((v) => !STARLESS.has(v.platform));
  const weighted = starred.filter((v) => v.rating != null).reduce((a, v) => ({ s: a.s + v.rating! * (v.total ?? v.reviews.length), n: a.n + (v.total ?? v.reviews.length) }), { s: 0, n: 0 });
  const all = live.flatMap((v) => v.reviews.map((r) => ({ ...r, platform: v.platform })));
  const stars = all.filter((r) => !STARLESS.has(r.platform));
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const summary = {
    combined_rating: weighted.n ? Math.round((weighted.s / weighted.n) * 100) / 100 : null,
    total_reviews: starred.reduce((a, v) => a + (v.total ?? v.reviews.length), 0),
    new_reviews_last_90_days: all.filter((r) => r.date && r.date >= since90).length,
    response_rate: stars.length ? Math.round((stars.filter((r) => r.reply).length / stars.length) * 100) / 100 : null,
    nextdoor_faves: views.find((v) => v.platform === "nextdoor")?.faves ?? null,
  };
  const platforms = views.map((v) => ({
    platform: v.platform, label: v.label, link: v.url || null, link_source: linkSource(v, saved), status: status(v),
    rating: v.rating, reviews: v.total, read_on: v.fetchedAt?.slice(0, 10) ?? null, ...(v.platform === "nextdoor" ? { faves: v.faves ?? null } : {}),
  }));
  const listingSearch = discovery
    ? { searched_on: discovery.at.slice(0, 10), found: Object.keys(discovery.links).map(labelOf), not_found: discovery.checked.filter((k) => !discovery.links[k]).map(labelOf), next_automatic_search_after: new Date(Date.parse(discovery.at) + DISCOVERY_EVERY_DAYS * 86_400_000).toISOString().slice(0, 10) }
    : { searched_on: null, note: "Not searched yet; the weekly refresh does it, or search now." };
  return { summary, platforms, all, listingSearch, collected, views, saved, discovery, pending: views.some((v) => v.status === "pending") };
}

/**
 * What a refresh / listing search would cost at most, and today's DataForSEO spend against the budget. A platform
 * whose collection is still running is skipped by the refresh (so it may cost less than this).
 */
export async function reviewCosts(admin: SupabaseClient, clientId: string, views: PlatformView[], discoveryAt: string | null) {
  const has = (k: PlatformKey) => Boolean(views.find((v) => v.platform === k)?.url);
  const google = has("google"), apis = FETCHABLE.filter(has), pages = CRAWLED.filter(has);
  const running = views.filter((v) => v.status === "pending").map((v) => v.label);
  const searchDue = !discoveryAt || Date.now() - Date.parse(discoveryAt) > DISCOVERY_EVERY_DAYS * 86_400_000;
  const refresh = (google ? REVIEWS_EST : 0) + apis.length * PLATFORM_EST + (searchDue ? DISCOVERY_EST + CRAWLED.length * CRAWL_EST : pages.length * CRAWL_EST);
  const find = DISCOVERY_EST + CRAWLED.length * CRAWL_EST;
  // the caps of the client's organization (its own DataForSEO account and daily limit)
  const [cap, spentAll, spentClient] = await Promise.all([getSettings(admin, { clientId }).then((s) => s.dailyBudget), orgSpendOrZero(admin, { clientId }), clientSpendOrZero(admin, clientId)]);
  return { refresh, find, searchDue, google, apis, pages, running, cap, spentAll, spentClient, clientCap: cap * PER_CLIENT_SHARE };
}

export const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
