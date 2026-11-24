/**
 * "AI and data" settings for the quick wins engine, stored per client in clients.settings.ai_qw.
 * Shared by server and client code (no secrets: the Anthropic and DataForSEO keys stay in server env vars).
 */
export const MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5 (best quality)", input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5 (lower cost)", input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
} as const;
export type ModelId = keyof typeof MODELS;
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export const DFS_FEATURES = {
  volume: "Search volume, difficulty and intent for Search Console queries (Labs keyword overview)",
  serp: "Live Google results for the top opportunity keywords (Deep and nightly runs only)",
  competitors: "Competitor keyword gap (keywords competitors rank for and you don't)",
  backlinks: "Backlink gap (sites linking to 2+ competitors but not you)",
  onpage: "On-page issues from the DataForSEO site audit, merged with the portal crawl",
  local: "Google Business Profile rating, reviews and map-pack data",
} as const;
export type DfsFeature = keyof typeof DFS_FEATURES;

export interface BusinessProfile { name: string; services: string; towns: string; phone: string; certifications: string; tone: string }

export interface AiQwSettings {
  model: ModelId;
  effort: Effort;
  /** dollars per calendar month for Claude in this client (0 = no Claude runs) */
  monthlyBudget: number;
  /** dollars per calendar month for DataForSEO calls started by this engine */
  dfsMonthlyBudget: number;
  nightly: boolean;
  dfs: Record<DfsFeature, boolean>;
  /** DataForSEO location and language; empty = the client's research target (usually United States / English) */
  locationName: string;
  languageCode: string;
  bannedWords: string[];
  business: BusinessProfile;
  /** who gets the morning email (owners and admins of the workspace when empty) */
  emailTo: string[];
}

export const DEFAULT_SETTINGS: AiQwSettings = {
  model: "claude-opus-5-5",
  effort: "medium",
  monthlyBudget: 20,
  dfsMonthlyBudget: 10,
  nightly: false,
  dfs: { volume: true, serp: true, competitors: true, backlinks: true, onpage: true, local: true },
  locationName: "",
  languageCode: "",
  bannedWords: [],
  business: { name: "", services: "", towns: "", phone: "", certifications: "", tone: "Plain, friendly and specific. No hype." },
  emailTo: [],
};

/** Merges stored settings over the defaults, ignoring anything malformed. */
export function readSettings(raw: unknown): AiQwSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<AiQwSettings>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
  return {
    model: s.model && s.model in MODELS ? s.model : DEFAULT_SETTINGS.model,
    effort: EFFORTS.includes(s.effort as Effort) ? (s.effort as Effort) : DEFAULT_SETTINGS.effort,
    monthlyBudget: num(s.monthlyBudget, DEFAULT_SETTINGS.monthlyBudget),
    dfsMonthlyBudget: num(s.dfsMonthlyBudget, DEFAULT_SETTINGS.dfsMonthlyBudget),
    nightly: typeof s.nightly === "boolean" ? s.nightly : DEFAULT_SETTINGS.nightly,
    dfs: Object.fromEntries((Object.keys(DFS_FEATURES) as DfsFeature[]).map((k) => [k, typeof s.dfs?.[k] === "boolean" ? s.dfs[k] : true])) as Record<DfsFeature, boolean>,
    locationName: str(s.locationName, ""),
    languageCode: str(s.languageCode, ""),
    bannedWords: Array.isArray(s.bannedWords) ? s.bannedWords.filter((w): w is string => typeof w === "string" && w.trim() !== "").map((w) => w.trim().toLowerCase()).slice(0, 50) : [],
    business: { ...DEFAULT_SETTINGS.business, ...Object.fromEntries(Object.entries(s.business ?? {}).filter(([, v]) => typeof v === "string")) } as BusinessProfile,
    emailTo: Array.isArray(s.emailTo) ? s.emailTo.filter((e): e is string => typeof e === "string" && /^\S+@\S+\.\S+$/.test(e)).slice(0, 10) : [],
  };
}

/** Cost of one call in dollars from its usage block. */
export function callCost(model: ModelId, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }, batch = false) {
  const p = MODELS[model];
  const usd = (u.input_tokens * p.input + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + u.output_tokens * p.output) / 1_000_000;
  return batch ? usd / 2 : usd;
}
