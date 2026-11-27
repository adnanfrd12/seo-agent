import "server-only";
import { createHash } from "node:crypto";

/**
 * Google Business Profile REST APIs (OAuth bearer token with the business.manage scope; an API key alone cannot
 * read private profile data). Errors are classified so the UI can say *why* a call failed: missing approval,
 * disabled API, missing permission, or an expired grant.
 *
 *   Account Management v1   mybusinessaccountmanagement  accounts.list
 *   Business Information v1 mybusinessbusinessinformation accounts.locations.list, locations.get
 *   Performance v1          businessprofileperformance   fetchMultiDailyMetricsTimeSeries, searchkeywords.impressions.monthly
 *   My Business v4          mybusiness                   reviews.list / updateReply / deleteReply, localPosts.list
 * All of them need the Google Cloud project's Business Profile API access to be approved (quota > 0).
 * Pure response parsers are in ./gbp-parse.ts (unit-tested without network).
 */
import {
  DAILY_METRICS as METRICS, DEPRECATED_DAILY_METRICS as DEPRECATED, parseDailySeries, parseKeywords, parsePosts, parseReviews, type DailyResponse, type KeywordRow, type KeywordsResponse,
  type LocalPostsResponse, type ParsedPost, type ParsedReview, type ReviewsResponse,
} from "./gbp-parse";

export { DAILY_METRICS, DEPRECATED_DAILY_METRICS, profileCompleteness, type DailyColumn, type KeywordRow, type ParsedPost, type ParsedReview } from "./gbp-parse";

const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERF = "https://businessprofileperformance.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";

export type GbpErrorKind = "auth" | "not_approved" | "api_disabled" | "permission" | "rate_limit" | "not_found" | "bad_request" | "other";

export class GbpApiError extends Error {
  constructor(public kind: GbpErrorKind, public status: number, message: string) {
    super(message);
  }
}

type GoogleErrorBody = { error?: { message?: string; status?: string; details?: { reason?: string; metadata?: Record<string, string> }[] } };

export function classify(status: number, body: GoogleErrorBody): GbpApiError {
  const e = body.error ?? {};
  const msg = (e.message ?? `HTTP ${status}`).slice(0, 400);
  const details = e.details ?? [];
  const reasons = details.map((d) => d.reason ?? "").join(" ");
  if (status === 401) return new GbpApiError("auth", status, `Google rejected the authorization: ${msg}`);
  if (status === 403 && /SCOPE/i.test(reasons)) {
    return new GbpApiError("auth", status, `Missing business.manage permission. Reconnect and approve all permissions. (${msg})`);
  }
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(`${reasons} ${msg}`)) {
    return new GbpApiError("api_disabled", status, `A Business Profile API is not enabled in the Google Cloud project: ${msg}`);
  }
  if (status === 403) return new GbpApiError("permission", status, `This Google account cannot access the profile: ${msg}`);
  if (status === 429) {
    // Projects that were never approved have a quota of 0 requests per minute and get 429 on every call.
    const zero = details.some((d) => d.metadata?.quota_limit_value === "0") || /limit of 0|quota.*\b0\b.*per minute|'Requests per minute' of service/i.test(msg);
    return zero
      ? new GbpApiError("not_approved", status, `Business Profile API access isn't approved for this Google Cloud project (quota 0). ${msg}`)
      : new GbpApiError("rate_limit", status, `Business Profile API rate limit: ${msg} If this keeps happening, the project's API access may not be approved yet (quota 0).`);
  }
  if (status === 404) return new GbpApiError("not_found", status, msg);
  if (status === 400) return new GbpApiError("bad_request", status, msg);
  return new GbpApiError("other", status, msg);
}

/**
 * A token, or a token plus the API key of the organization whose OAuth client made the grant (GOOGLE_API_KEY,
 * same Cloud project), so requests are counted against that organization's project. Never another organization's key.
 */
export type GbpAuth = string | { token: string; apiKey?: string | null };
const tokenOf = (a: GbpAuth) => (typeof a === "string" ? a : a.token);
const keyOf = (a: GbpAuth) => (typeof a === "string" ? null : a.apiKey || null);

/** keys Google refused this instance (by hash): requests go on without them */
const rejectedKeys = new Set<string>();
const keyId = (key: string) => createHash("sha256").update(key).digest("hex");

async function call<T>(auth: GbpAuth, url: string, init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const key = keyOf(auth);
    const useKey = Boolean(key) && !rejectedKeys.has(keyId(key!));
    const headers: Record<string, string> = { authorization: `Bearer ${tokenOf(auth)}` };
    if (useKey) headers["x-goog-api-key"] = key!;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(url, {
      method: init.method ?? "GET", headers, cache: "no-store",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    const body = (await res.json().catch(() => ({}))) as GoogleErrorBody;
    if (useKey && res.status !== 429 && /API_KEY|api key|API key/i.test(JSON.stringify(body))) {
      rejectedKeys.add(keyId(key!));
      continue;
    }
    const err = classify(res.status, body);
    // brief retry for transient errors (reads only); the queue's exponential back-off handles the rest
    if ((init.method ?? "GET") === "GET" && (err.kind === "rate_limit" || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw err;
  }
}

const page = (token: string) => (token ? `&pageToken=${encodeURIComponent(token)}` : "");

export type GbpAccount = { name: string; accountName?: string; type?: string; role?: string; verificationState?: string };
type TimeOfDay = { hours?: number; minutes?: number };
export type GbpLocation = {
  name: string; title?: string; storeCode?: string; websiteUri?: string; languageCode?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string };
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  categories?: { primaryCategory?: { name?: string; displayName?: string }; additionalCategories?: { name?: string; displayName?: string }[] };
  metadata?: { mapsUri?: string; placeId?: string; newReviewUri?: string; hasVoiceOfMerchant?: boolean; hasGoogleUpdated?: boolean; duplicateLocation?: string };
  openInfo?: { status?: string; openingDate?: { year?: number; month?: number; day?: number } };
  regularHours?: { periods?: { openDay?: string; openTime?: TimeOfDay; closeDay?: string; closeTime?: TimeOfDay }[] };
  specialHours?: { specialHourPeriods?: Record<string, unknown>[] };
  moreHours?: { hoursTypeId?: string; periods?: Record<string, unknown>[] }[];
  serviceArea?: { businessType?: string; places?: { placeInfos?: { placeName?: string; placeId?: string }[] }; regionCode?: string };
  labels?: string[];
  profile?: { description?: string };
  latlng?: { latitude?: number; longitude?: number };
  serviceItems?: Record<string, unknown>[];
  relationshipData?: Record<string, unknown>;
  adWordsLocationExtensions?: Record<string, unknown>;
};

export async function listAccounts(auth: GbpAuth): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let next = "";
  do {
    const r = await call<{ accounts?: GbpAccount[]; nextPageToken?: string }>(auth, `${ACCOUNTS}/accounts?pageSize=20${page(next)}`);
    out.push(...(r.accounts ?? []));
    next = r.nextPageToken ?? "";
  } while (next);
  return out;
}

const LIST_MASK = "name,title,storeCode,websiteUri,storefrontAddress,phoneNumbers,categories,metadata,openInfo";
/** Every top-level Location field (Business Information v1). */
export const FULL_MASK = [
  "name", "languageCode", "storeCode", "title", "phoneNumbers", "categories", "storefrontAddress", "websiteUri",
  "regularHours", "specialHours", "serviceArea", "labels", "adWordsLocationExtensions", "latlng", "openInfo",
  "metadata", "profile", "relationshipData", "moreHours", "serviceItems",
].join(",");

export async function listLocations(auth: GbpAuth, account: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let next = "";
  do {
    const r = await call<{ locations?: GbpLocation[]; nextPageToken?: string }>(
      auth, `${INFO}/${account}/locations?readMask=${LIST_MASK}&pageSize=100${page(next)}`);
    out.push(...(r.locations ?? []));
    next = r.nextPageToken ?? "";
  } while (next);
  return out;
}

/** The full business information of one location (locations/{id}). */
export async function getLocation(auth: GbpAuth, location: string): Promise<GbpLocation> {
  return call<GbpLocation>(auth, `${INFO}/${location}?readMask=${FULL_MASK}`);
}

function dayParams(field: string, d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `dailyRange.${field}.year=${y}&dailyRange.${field}.month=${m}&dailyRange.${field}.day=${day}`;
}
function monthParams(field: string, d: string) {
  const [y, m] = d.split("-").map(Number);
  return `monthlyRange.${field}.year=${y}&monthlyRange.${field}.month=${m}`;
}

/**
 * Daily metrics for one location: date -> column -> value. Every DailyMetric is requested. BUSINESS_CONVERSATIONS
 * and BUSINESS_FOOD_ORDERS are marked deprecated by Google; if Google ever rejects them (400), the request is
 * repeated without them so the other metrics still arrive.
 */
export async function fetchDailyMetrics(auth: GbpAuth, locationId: string, start: string, end: string) {
  const url = (names: string[]) =>
    `${PERF}/${locationId}:fetchMultiDailyMetricsTimeSeries?${names.map((m) => `dailyMetrics=${m}`).join("&")}&${dayParams("start_date", start)}&${dayParams("end_date", end)}`;
  const all = Object.keys(METRICS);
  try {
    return parseDailySeries(await call<DailyResponse>(auth, url(all)));
  } catch (e) {
    if (!(e instanceof GbpApiError && e.kind === "bad_request")) throw e;
    return parseDailySeries(await call<DailyResponse>(auth, url(all.filter((m) => !DEPRECATED.includes(m)))));
  }
}

/** Search keywords for ONE month (the API sums values across a multi-month range). */
export async function fetchMonthlyKeywords(auth: GbpAuth, locationId: string, month: string): Promise<KeywordRow[]> {
  const out: KeywordRow[] = [];
  let next = "";
  do {
    const url = `${PERF}/${locationId}/searchkeywords/impressions/monthly?${monthParams("start_month", month)}&${monthParams("end_month", month)}&pageSize=100${page(next)}`;
    const r = await call<KeywordsResponse>(auth, url);
    out.push(...parseKeywords(r));
    next = r.nextPageToken ?? "";
  } while (next);
  return out;
}

/** "accounts/{a}/locations/{l}" -> its parts; also accepts "locations/{l}" (account then null). */
export function splitLocationName(name: string): { account: string | null; location: string; locationId: string } {
  const m = name.match(/^(accounts\/[^/]+)\/(locations\/([^/]+))$/);
  if (m) return { account: m[1], location: m[2], locationId: m[3] };
  const id = name.replace(/^.*locations\//, "");
  return { account: null, location: `locations/${id}`, locationId: id };
}

/** Every review of a location (v4, 50 per page, newest updates first). */
export async function listReviews(auth: GbpAuth, parent: string): Promise<{ reviews: ParsedReview[]; averageRating: number | null; total: number | null }> {
  const out: ParsedReview[] = [];
  let next = "", avg: number | null = null, total: number | null = null;
  for (let i = 0; i < 400; i++) {
    const r = await call<ReviewsResponse>(auth, `${V4}/${parent}/reviews?pageSize=50&orderBy=${encodeURIComponent("updateTime desc")}${page(next)}`);
    out.push(...parseReviews(r));
    avg ??= typeof r.averageRating === "number" ? r.averageRating : null;
    total ??= typeof r.totalReviewCount === "number" ? r.totalReviewCount : null;
    next = r.nextPageToken ?? "";
    if (!next) break;
  }
  return { reviews: out, averageRating: avg, total };
}

/** Posts or updates the owner's reply (PUT .../reviews/{r}/reply). Google allows up to 4096 bytes. */
export async function updateReviewReply(auth: GbpAuth, reviewName: string, comment: string) {
  return call<{ comment?: string; updateTime?: string; reviewReplyState?: string }>(auth, `${V4}/${reviewName}/reply`, { method: "PUT", body: { comment } });
}

/** Deletes the owner's reply (DELETE .../reviews/{r}/reply). */
export async function deleteReviewReply(auth: GbpAuth, reviewName: string) {
  await call<unknown>(auth, `${V4}/${reviewName}/reply`, { method: "DELETE" });
}

/** Every post of a location (v4 localPosts, 100 per page). */
export async function listPosts(auth: GbpAuth, parent: string): Promise<ParsedPost[]> {
  const out: ParsedPost[] = [];
  let next = "";
  for (let i = 0; i < 100; i++) {
    const r = await call<LocalPostsResponse>(auth, `${V4}/${parent}/localPosts?pageSize=100${page(next)}`);
    out.push(...parsePosts(r));
    next = r.nextPageToken ?? "";
    if (!next) break;
  }
  return out;
}

/*
 * Per-post metrics: v4 localPosts:reportInsights is still listed in Google's reference, but it answers 404 (checked
 * live on 2026-11-27 with an approved project), and the Performance API has no per-post metrics. So post metrics
 * aren't imported; gbp_posts.metrics stays empty until Google offers them again.
 */
