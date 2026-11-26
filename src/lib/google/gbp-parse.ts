/**
 * Pure parsers for Google Business Profile API responses (no network, no secrets), shared by the sync and the
 * dashboard. Shapes follow Google's reference docs for Performance v1, Business Information v1 and My Business v4.
 */

/** DailyMetric enum value -> gbp_daily_metrics column. Every value Google documents (except DAILY_METRIC_UNKNOWN). */
export const DAILY_METRICS = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressions_desktop_maps",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressions_desktop_search",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressions_mobile_maps",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressions_mobile_search",
  BUSINESS_CONVERSATIONS: "conversations",
  BUSINESS_DIRECTION_REQUESTS: "direction_requests",
  CALL_CLICKS: "call_clicks",
  WEBSITE_CLICKS: "website_clicks",
  MESSAGING_CLICKS: "messaging_clicks",
  BUSINESS_BOOKINGS: "bookings",
  BUSINESS_FOOD_ORDERS: "food_orders",
  BUSINESS_FOOD_MENU_CLICKS: "food_menu_clicks",
} as const;
export type DailyColumn = (typeof DAILY_METRICS)[keyof typeof DAILY_METRICS];
/** Marked deprecated in Google's DailyMetric reference (still valid values). */
export const DEPRECATED_DAILY_METRICS: string[] = ["BUSINESS_CONVERSATIONS", "BUSINESS_FOOD_ORDERS"];

type GDate = { year: number; month: number; day?: number };
const isoDate = (d: GDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}`;

export type DailyResponse = {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: { dailyMetric: string; timeSeries?: { datedValues?: { date: GDate; value?: string }[] } }[];
  }[];
};

/**
 * date -> column -> value. Google omits `value` when it is zero, so a dated entry without a value is 0.
 * Metrics Google didn't return at all are absent (not reported), never 0.
 */
export function parseDailySeries(r: DailyResponse): Map<string, Partial<Record<DailyColumn, number>>> {
  const byDate = new Map<string, Partial<Record<DailyColumn, number>>>();
  for (const group of r.multiDailyMetricTimeSeries ?? []) {
    for (const s of group.dailyMetricTimeSeries ?? []) {
      const col = DAILY_METRICS[s.dailyMetric as keyof typeof DAILY_METRICS];
      if (!col) continue;
      for (const dv of s.timeSeries?.datedValues ?? []) {
        if (!dv?.date?.year || !dv.date.month) continue;
        const d = isoDate(dv.date);
        const row = byDate.get(d) ?? {};
        const n = Number(dv.value ?? 0);
        row[col] = Number.isFinite(n) ? n : 0;
        byDate.set(d, row);
      }
    }
  }
  return byDate;
}

/**
 * Rows to upsert without ever replacing a stored value by "not reported": each row carries only the columns Google
 * returned, grouped by column set so every upsert batch has uniform keys (PostgREST updates only the sent columns).
 */
export function dailyUpsertGroups<B extends Record<string, unknown>>(byDate: Map<string, Partial<Record<DailyColumn, number>>>, base: B) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const [metric_date, values] of byDate) {
    const cols = Object.keys(values).sort();
    if (!cols.length) continue;
    const key = cols.join(",");
    groups.set(key, [...(groups.get(key) ?? []), { ...base, metric_date, ...values }]);
  }
  return [...groups.values()];
}

export type KeywordRow = { keyword: string; impressions: number | null; threshold: number | null };
export type KeywordsResponse = { searchKeywordsCounts?: { searchKeyword: string; insightsValue?: { value?: string; threshold?: string } }[]; nextPageToken?: string };

export function parseKeywords(r: KeywordsResponse): KeywordRow[] {
  return (r.searchKeywordsCounts ?? []).filter((k) => k?.searchKeyword).map((k) => ({
    keyword: k.searchKeyword.trim().toLowerCase(),
    impressions: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null,
    threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null,
  }));
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export type ReviewsResponse = {
  reviews?: {
    name?: string; reviewId?: string; reviewer?: { profilePhotoUrl?: string; displayName?: string; isAnonymous?: boolean };
    starRating?: string; comment?: string; createTime?: string; updateTime?: string;
    reviewReply?: { comment?: string; updateTime?: string; reviewReplyState?: string };
  }[];
  averageRating?: number; totalReviewCount?: number; nextPageToken?: string;
};
export type ParsedReview = {
  remoteId: string; name: string | null; rating: number | null; text: string | null; reviewer: string | null; photo: string | null;
  createdAt: string | null; updatedAt: string | null; reply: string | null; repliedAt: string | null; replyState: string | null;
  raw: Record<string, unknown>;
};

export function parseReviews(r: ReviewsResponse): ParsedReview[] {
  return (r.reviews ?? []).flatMap((v) => {
    const id = v.reviewId ?? v.name?.split("/").pop();
    if (!id) return [];
    return [{
      remoteId: id, name: v.name ?? null, rating: STARS[v.starRating ?? ""] ?? null, text: v.comment?.trim() || null,
      reviewer: v.reviewer?.isAnonymous ? null : v.reviewer?.displayName ?? null,
      photo: v.reviewer?.isAnonymous ? null : v.reviewer?.profilePhotoUrl ?? null,
      createdAt: v.createTime ?? null, updatedAt: v.updateTime ?? null,
      reply: v.reviewReply?.comment?.trim() || null, repliedAt: v.reviewReply?.updateTime ?? null, replyState: v.reviewReply?.reviewReplyState ?? null,
      raw: v as Record<string, unknown>,
    }];
  });
}

export type LocalPostsResponse = {
  localPosts?: {
    name?: string; languageCode?: string; summary?: string; callToAction?: { actionType?: string; url?: string };
    createTime?: string; updateTime?: string; event?: Record<string, unknown>; state?: string;
    media?: { name?: string; mediaFormat?: string; googleUrl?: string; thumbnailUrl?: string; sourceUrl?: string }[];
    searchUrl?: string; topicType?: string; alertType?: string; offer?: Record<string, unknown>;
  }[];
  nextPageToken?: string;
};
export type ParsedPost = {
  name: string; topicType: string | null; state: string | null; summary: string | null; languageCode: string | null;
  ctaType: string | null; ctaUrl: string | null; searchUrl: string | null;
  media: { format: string | null; url: string | null; thumbnail: string | null }[];
  event: Record<string, unknown> | null; offer: Record<string, unknown> | null; createdAt: string | null; updatedAt: string | null;
  raw: Record<string, unknown>;
};

export function parsePosts(r: LocalPostsResponse): ParsedPost[] {
  return (r.localPosts ?? []).flatMap((p) => p.name ? [{
    name: p.name, topicType: p.topicType ?? null, state: p.state ?? null, summary: p.summary ?? null, languageCode: p.languageCode ?? null,
    ctaType: p.callToAction?.actionType ?? null, ctaUrl: p.callToAction?.url ?? null, searchUrl: p.searchUrl ?? null,
    media: (p.media ?? []).map((m) => ({ format: m.mediaFormat ?? null, url: m.googleUrl ?? m.sourceUrl ?? null, thumbnail: m.thumbnailUrl ?? null })),
    event: p.event ?? null, offer: p.offer ?? null, createdAt: p.createTime ?? null, updatedAt: p.updateTime ?? null,
    raw: p as Record<string, unknown>,
  }] : []);
}

type LooseLocation = {
  title?: string; websiteUri?: string; phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: unknown; additionalCategories?: unknown[] };
  storefrontAddress?: { addressLines?: string[] }; serviceArea?: { places?: { placeInfos?: unknown[] } };
  regularHours?: { periods?: unknown[] }; profile?: { description?: string }; openInfo?: { openingDate?: unknown };
  specialHours?: { specialHourPeriods?: unknown[] }; serviceItems?: unknown[];
};

/**
 * Profile completeness: Google's API has no completeness score, so this is our checklist of the fields a complete
 * profile fills in (each counts equally).
 */
export function profileCompleteness(l: LooseLocation) {
  const checks: [string, boolean][] = [
    ["Business name", Boolean(l.title)],
    ["Primary category", Boolean(l.categories?.primaryCategory)],
    ["Additional categories", (l.categories?.additionalCategories?.length ?? 0) > 0],
    ["Phone number", Boolean(l.phoneNumbers?.primaryPhone)],
    ["Website", Boolean(l.websiteUri)],
    ["Address or service area", (l.storefrontAddress?.addressLines?.length ?? 0) > 0 || (l.serviceArea?.places?.placeInfos?.length ?? 0) > 0],
    ["Opening hours", (l.regularHours?.periods?.length ?? 0) > 0],
    ["Description (100+ characters)", (l.profile?.description?.trim().length ?? 0) >= 100],
    ["Opening date", Boolean(l.openInfo?.openingDate)],
    ["Services", (l.serviceItems?.length ?? 0) > 0],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { score: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([k]) => k) };
}
