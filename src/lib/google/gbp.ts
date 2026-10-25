import "server-only";

/**
 * Google Business Profile REST APIs (OAuth bearer token; an API key alone cannot read private
 * profile data). Errors are classified so the UI can say *why* a call failed: missing approval,
 * disabled API, missing permission, or an expired grant.
 */
const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERF = "https://businessprofileperformance.googleapis.com/v1";

export type GbpErrorKind = "auth" | "not_approved" | "api_disabled" | "permission" | "rate_limit" | "not_found" | "other";

export class GbpApiError extends Error {
  constructor(public kind: GbpErrorKind, public status: number, message: string) {
    super(message);
  }
}

type GoogleErrorBody = { error?: { message?: string; status?: string; details?: { reason?: string; metadata?: Record<string, string> }[] } };

function classify(status: number, body: GoogleErrorBody): GbpApiError {
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
    const zero = details.some((d) => d.metadata?.quota_limit_value === "0") || /limit of 0|quota.*\b0\b.*per minute/i.test(msg);
    return zero
      ? new GbpApiError("not_approved", status, `Business Profile API access isn't approved for this Google Cloud project (quota 0). ${msg}`)
      : new GbpApiError("rate_limit", status, `Business Profile API rate limit: ${msg} If this keeps happening, the project's API access may not be approved yet (quota 0).`);
  }
  if (status === 404) return new GbpApiError("not_found", status, msg);
  return new GbpApiError("other", status, msg);
}

async function call<T>(token: string, url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    const err = classify(res.status, (await res.json().catch(() => ({}))) as GoogleErrorBody);
    // brief retry for transient errors; the queue's exponential back-off handles the rest
    if ((err.kind === "rate_limit" || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw err;
  }
}

const page = (token: string) => (token ? `&pageToken=${encodeURIComponent(token)}` : "");

export type GbpAccount = { name: string; accountName?: string; type?: string; role?: string; verificationState?: string };
export type GbpLocation = {
  name: string; title?: string; storeCode?: string; websiteUri?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string };
  phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: { displayName?: string } };
  metadata?: { mapsUri?: string; placeId?: string; newReviewUri?: string };
  openInfo?: { status?: string };
};

export async function listAccounts(token: string): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let next = "";
  do {
    const r = await call<{ accounts?: GbpAccount[]; nextPageToken?: string }>(token, `${ACCOUNTS}/accounts?pageSize=20${page(next)}`);
    out.push(...(r.accounts ?? []));
    next = r.nextPageToken ?? "";
  } while (next);
  return out;
}

const READ_MASK = "name,title,storeCode,websiteUri,storefrontAddress,phoneNumbers,categories,metadata,openInfo";

export async function listLocations(token: string, account: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let next = "";
  do {
    const r = await call<{ locations?: GbpLocation[]; nextPageToken?: string }>(
      token, `${INFO}/${account}/locations?readMask=${READ_MASK}&pageSize=100${page(next)}`);
    out.push(...(r.locations ?? []));
    next = r.nextPageToken ?? "";
  } while (next);
  return out;
}

/** DailyMetric enum value -> gbp_daily_metrics column. */
export const DAILY_METRICS = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressions_desktop_maps",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressions_desktop_search",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressions_mobile_maps",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressions_mobile_search",
  CALL_CLICKS: "call_clicks",
  WEBSITE_CLICKS: "website_clicks",
  BUSINESS_DIRECTION_REQUESTS: "direction_requests",
  BUSINESS_BOOKINGS: "bookings",
  BUSINESS_FOOD_MENU_CLICKS: "food_menu_clicks",
  MESSAGING_CLICKS: "messaging_clicks",
} as const;
export type DailyColumn = (typeof DAILY_METRICS)[keyof typeof DAILY_METRICS];

type GDate = { year: number; month: number; day?: number };
const isoDate = (d: GDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}`;
function dayParams(field: string, d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `dailyRange.${field}.year=${y}&dailyRange.${field}.month=${m}&dailyRange.${field}.day=${day}`;
}
function monthParams(field: string, d: string) {
  const [y, m] = d.split("-").map(Number);
  return `monthlyRange.${field}.year=${y}&monthlyRange.${field}.month=${m}`;
}

/**
 * Daily metrics for one location: date -> column -> value. Google omits zero values, so a
 * metric that appears for a location but has no value on a date is stored as 0.
 */
export async function fetchDailyMetrics(token: string, locationId: string, start: string, end: string) {
  const metrics = Object.keys(DAILY_METRICS).map((m) => `dailyMetrics=${m}`).join("&");
  const url = `${PERF}/${locationId}:fetchMultiDailyMetricsTimeSeries?${metrics}&${dayParams("start_date", start)}&${dayParams("end_date", end)}`;
  const r = await call<{
    multiDailyMetricTimeSeries?: {
      dailyMetricTimeSeries?: { dailyMetric: keyof typeof DAILY_METRICS; timeSeries?: { datedValues?: { date: GDate; value?: string }[] } }[];
    }[];
  }>(token, url);
  const byDate = new Map<string, Partial<Record<DailyColumn, number>>>();
  for (const group of r.multiDailyMetricTimeSeries ?? []) {
    for (const s of group.dailyMetricTimeSeries ?? []) {
      const col = DAILY_METRICS[s.dailyMetric];
      if (!col) continue;
      for (const dv of s.timeSeries?.datedValues ?? []) {
        const d = isoDate(dv.date);
        const row = byDate.get(d) ?? {};
        row[col] = Number(dv.value ?? 0);
        byDate.set(d, row);
      }
    }
  }
  return byDate;
}

export type KeywordRow = { keyword: string; impressions: number | null; threshold: number | null };

/** Search keywords for ONE month (the API sums values across a multi-month range). */
export async function fetchMonthlyKeywords(token: string, locationId: string, month: string): Promise<KeywordRow[]> {
  const out: KeywordRow[] = [];
  let next = "";
  do {
    const url = `${PERF}/${locationId}/searchkeywords/impressions/monthly?${monthParams("start_month", month)}&${monthParams("end_month", month)}&pageSize=100${page(next)}`;
    const r = await call<{ searchKeywordsCounts?: { searchKeyword: string; insightsValue?: { value?: string; threshold?: string } }[]; nextPageToken?: string }>(token, url);
    for (const k of r.searchKeywordsCounts ?? []) {
      out.push({
        keyword: k.searchKeyword,
        impressions: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null,
        threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null,
      });
    }
    next = r.nextPageToken ?? "";
  } while (next);
  return out;
}
