// Run: npm test   (node:test via tsx; no network, no database, no API keys needed)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "x";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";
process.env.COMPOSIO_API_KEY ??= "x";
process.env.COMPOSIO_AUTH_CONFIG_GA4 ??= "x";
process.env.COMPOSIO_AUTH_CONFIG_GSC ??= "x";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.CRON_SECRET ??= "0123456789abcdef0123";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
const { flatten } = await import("@/lib/clarity/api");
const { monthlyWins, notableDeclines } = await import("@/lib/report/data");
const { dailySeries } = await import("@/lib/analytics/trend");
const { monthRange, previousMonth, resolveRange } = await import("@/lib/analytics/range");
const { pctChange, isFavorable } = await import("@/lib/analytics/format");
const { csvCell } = await import("@/lib/analytics/csv");
const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
const schemas = await import("@/lib/ai/schemas");

test("token encryption round-trips and detects tampering", () => {
  const packed = encryptSecret("clarity-token-123");
  assert.notEqual(packed.includes("clarity-token-123"), true);
  assert.equal(decryptSecret(packed), "clarity-token-123");
  const parts = packed.split("."); parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptSecret(parts.join(".")));
});

test("Clarity responses flatten to one row per value and metric (documented sample shape)", () => {
  const rows = flatten([{ metricName: "Traffic", information: [
    { totalSessionCount: "9554", totalBotSessionCount: "8369", distantUserCount: "189733", PagesPerSessionPercentage: 1.0931, Device: "PC" },
    { totalSessionCount: "291942", Device: "Mobile" },
  ] }, { metricName: "RageClickCount", information: [{ sessionsCount: "120", sessionsWithMetricPercentage: 2.5, subTotal: "37", Device: "Mobile" }] }], "Device");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.dimension, r.value, r.metric]), [["device", "PC", "Traffic"], ["device", "Mobile", "Traffic"], ["device", "Mobile", "RageClickCount"]]);
  assert.equal(rows[0].count, 9554);
  assert.equal(rows[2].count, 37);
  assert.equal(rows[2].sessions_pct, 2.5);
});

test("period maths: months, previous month, last-month preset", () => {
  assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28", days: 28 });
  assert.deepEqual(monthRange("2028-02"), { start: "2028-02-01", end: "2028-02-29", days: 29 });
  assert.equal(previousMonth("2026-01-10"), "2025-12");
  const r = resolveRange({ range: "month" }, "UTC", 30);
  assert.equal(r.preset, "month");
  assert.equal(r.start.endsWith("-01"), true);
});

test("percent change is null (not 0 or Infinity) without a comparable base", () => {
  assert.equal(pctChange(10, 0), null);
  assert.equal(pctChange(10, null), null);
  assert.equal(pctChange(120, 100), 20);
  assert.equal(isFavorable(-5, false), true); // lower average position is better
});

test("daily series fills gaps: counts as 0, ratios as empty", () => {
  const t = { current: [{ date: "2026-09-01", clicks: 3, ctr: 0.1 }, { date: "2026-09-03", clicks: 1, ctr: 0.05 }], previous: [] };
  const counts = dailySeries(t, "clicks", { start: "2026-09-01", end: "2026-09-03" });
  const ratios = dailySeries(t, "ctr", { start: "2026-09-01", end: "2026-09-03" }, "ratio");
  assert.deepEqual(counts.map((p) => p.value), [3, 0, 1]);
  assert.deepEqual(ratios.map((p) => p.value), [0.1, null, 0.05]);
});

test("monthly wins need +10% AND enough volume; position improves downward", () => {
  const T = (o: Record<string, number>) => ({ has_data: true, ...o });
  const d = {
    range: { start: "2026-09-01", end: "2026-09-30" }, connected: { ga4: true, gsc: true, gbp: false, clarity: false },
    ga4: { current: T({ users: 1100, sessions: 60, key_events: 2 }), previous: T({ users: 900, sessions: 50, key_events: 1 }), mom: T({}), yoy: { has_data: false } },
    gsc: { current: T({ clicks: 4, impressions: 900, position: 20 }), previous: T({ clicks: 2, impressions: 1000, position: 30 }), mom: T({}), yoy: { has_data: false } },
    ga4Trend: { current: [], previous: [] }, gscTrend: { current: [], previous: [] }, channels: [], devices: [], keyEvents: [],
    landingPages: [], topQueries: [], topPages: [], opportunities: null, ai: null, clarity: null, errors: [],
  } as unknown as Parameters<typeof monthlyWins>[0];
  const wins = monthlyWins(d).map((w) => w.label);
  assert.ok(wins.includes("Users"));            // +22% on 1,100
  assert.ok(wins.includes("Sessions"));         // +20% on 60
  assert.ok(!wins.includes("Key events"));      // +100% but only 2: too little volume
  assert.ok(!wins.includes("Organic clicks"));  // +100% but only 4 clicks
  assert.ok(wins.includes("Average position")); // 30 -> 20 is an improvement
  assert.ok(notableDeclines(d).some((w) => w.label === "Search impressions")); // -10%
});

test("CSV cells defuse spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test("AI output schemas convert to structured-output JSON schemas", () => {
  for (const s of [schemas.insightsSchema, schemas.strategySchema, schemas.extractionSchema]) {
    const f = betaZodOutputFormat(s);
    assert.equal(f.type, "json_schema");
  }
  const ok = schemas.recommendationSchema.safeParse({
    category: "content", title: "t", summary: "s", supporting_metrics: [], evidence_references: ["gsc.clicks.current"], target_url: null,
    recommended_action: "a", priority: "high", confidence: "medium", estimated_effort: "small", expected_impact_hypothesis: "h", success_metric: "m",
  });
  assert.equal(ok.success, true);
  assert.equal(schemas.recommendationSchema.safeParse({ title: "missing fields" }).success, false);
});
