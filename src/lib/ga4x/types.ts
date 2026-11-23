/** Shared shapes of the GA4 leads module (stored in dfs_cache, endpoint "ga4x"). */

export type Cell = string | number;
/** One synced report: column names (dimensions then metrics) and its rows, one per day (or hour) and dimension combination. */
export interface Cube { cols: string[]; rows: Cell[][]; error?: string; truncated?: boolean }

export type CubeName =
  | "daily" | "events" | "links" | "sessions" | "leads" | "leads2" | "leads3" | "hours" | "geo" | "res" | "sessions2" | "pages" | "pageEvents" | "search"
  | "ads" | "items" | "ecom" | "coupons" | "refunds";

export interface TrackingFinding { action: string; kind: "call" | "email" | "sms" | "directions" | "form" | "chat" | "booking"; found: string[]; pages: string[] }

export interface Ga4xMeta {
  fetchedAt: string;
  property: string;
  propertyName: string | null;
  resourceId: string;
  timezone: string;
  currency: string | null;
  start: string;
  end: string;
  streamUrl: string | null;
  measurementId?: string | null;
  keyEvents: string[];
  customDimensions: { parameterName: string; displayName: string; scope: string }[];
  config: {
    retention: string | null; signals: string | null; bigquery: boolean | null; googleAds: boolean | null; searchConsole: boolean | null;
    customDimensionNames: string[];
  };
  /** virtual lead events made from link clicks and thank-you page views (GA4 has no named event for them) */
  fallbacks: string[];
  crawl: { pages: string[]; findings: TrackingFinding[]; error?: string } | null;
  errors: Record<string, string>;
  ecommerce: boolean;
}

/** Users over a date range (not additive across days, so read per range and cached). */
export interface RangeUsers {
  fetchedAt: string;
  start: string; end: string; pstart: string; pend: string;
  totals: { cur: { activeUsers: number; newUsers: number; totalUsers: number }; prev: { activeUsers: number; newUsers: number; totalUsers: number } };
  byPage: Record<string, number>;
  byCity: Record<string, number>;
  byEvent: Record<string, number>;
  ageGender: { age: string; gender: string; users: number }[];
  error?: string;
}
