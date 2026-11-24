// Run: npm test   (pure checks of the AI quick wins engine: no network, no database, no API keys)
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "x";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";
process.env.COMPOSIO_API_KEY ??= "x";
process.env.COMPOSIO_AUTH_CONFIG_GA4 ??= "x";
process.env.COMPOSIO_AUTH_CONFIG_GSC ??= "x";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.CRON_SECRET ??= "0123456789abcdef0123";

const { numbersIn, unknownNumbers, suggestedLengths, bannedIn, validateItem, scoreOf } = await import("@/lib/aiqw/validate");
const { readSettings, callCost } = await import("@/lib/aiqw/settings");
const { batchCustomId, chunkCandidates } = await import("@/lib/aiqw/claude");
const { pickForScope, weightedGain } = await import("@/lib/aiqw/candidates");
const { QuickWinsSchema } = await import("@/lib/aiqw/schema");
const { resultHost, resultUrl } = await import("@/lib/aiqw/dfs");
const { buildCandidates } = await import("@/lib/aiqw/candidates");
import type { Candidate } from "@/lib/aiqw/types";
import type { QuickWinItem } from "@/lib/aiqw/schema";

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  candidate_id: "gsc:title/roof", rule: "gsc:Title rewrite", page_url: "/roof", scope_screens: ["gsc:pages"],
  facts: [{ name: "Impressions (28 days)", value: 4100, source: "gsc" }, { name: "CTR", value: "1.2%", source: "gsc" }],
  queries: [{ query: "roof cost", impressions: 4100, position: 17.8, ctr: 0.012 }], page_context: null,
  computed_gain: 23.4, gain_unit: "clicks/mo", effort_hint: "Low", sources: ["gsc"], draft: { title: "t", where: "w", steps: ["a"] }, ...over,
});
const item = (over: Partial<QuickWinItem> = {}): QuickWinItem => ({
  candidate_id: "gsc:title/roof", keep: true, skip_reason: null, title: "Rewrite the title of /roof", type: "Title rewrite", page_url: "/roof", where: "Title tag",
  why: "\"roof cost\" has 4,100 impressions at position 17.8 with a 1.2% CTR. The rewrite is worth about 23.4 clicks a month.", steps: ["One", "Two", "Three"],
  suggested_change: "Title: Roof Replacement Cost Per Square Foot in Kentucky 2026\nMeta description: " + "x".repeat(150), queries_to_use: ["roof cost"],
  effort: "Low", confidence: "High", measure: "CTR in 28 days", plain_summary: "Better title.", ...over,
});

test("numbers are extracted with thousands separators, decimals and percents", () => {
  assert.deepEqual(numbersIn("4,100 impressions at 17.8 and 1.2% CTR").map((n) => [n.value, n.pct]), [[4100, false], [17.8, false], [1.2, true]]);
});

test("only numbers present in the candidate pass (rounding and fraction↔percent allowed)", () => {
  const c = cand();
  assert.deepEqual(unknownNumbers("4,100 impressions, position 17.8, CTR 1.2%, gain 23.4", c), []);
  assert.deepEqual(unknownNumbers("position 18 and 4100 impressions", c), [], "rounding is allowed");
  assert.deepEqual(unknownNumbers("there were 9,999 impressions", c), ["9,999"]);
  assert.deepEqual(unknownNumbers("within 28 days in 2026", c), [], "periods and years are free");
});

test("suggested title and meta lengths are read from the suggested change", () => {
  const l = suggestedLengths("Title: Roof Replacement Cost Per Square Foot in Kentucky 2026\n**Meta description:** \"" + "y".repeat(150) + "\"");
  assert.deepEqual(l, { title: [54], meta: [150] });
});

test("banned words are found as whole words only", () => {
  assert.deepEqual(bannedIn(item({ plain_summary: "Get a free quote" }), ["free"]), ["free"]);
  assert.deepEqual(bannedIn(item({ plain_summary: "Carefree service" }), ["free"]), []);
});

test("validateItem: unknown candidate, page not in data, invented number, length and banned word are all caught", () => {
  const byId = new Map([["gsc:title/roof", cand()]]);
  const inv = new Set(["/roof", "/contact"]);
  assert.equal(validateItem(item(), byId, inv, []), null);
  assert.match(validateItem(item({ candidate_id: "nope" }), byId, inv, [])![0], /not in this chunk/);
  assert.match(validateItem(item({ page_url: "/made-up" }), byId, inv, [])![0], /not a page in the data/);
  assert.equal(validateItem(item({ page_url: "https://example.com/contact" }), byId, inv, []), null, "another known page is fine");
  assert.match(validateItem(item({ why: "It gets 77,777 impressions." }), byId, inv, [])!.join(), /77,777/);
  assert.match(validateItem(item({ suggested_change: "Title: Too short" }), byId, inv, [])!.join(), /suggested title is 9/);
  assert.match(validateItem(item({ title: "Get a free roof check" }), byId, inv, ["free"])!.join(), /banned/);
  assert.equal(validateItem(item({ keep: false, why: "999,999" }), byId, inv, []), null, "skipped items aren't checked");
});

test("numbers of merged candidates may be quoted by the item that absorbed them", () => {
  const byId = new Map([["gsc:title/roof", cand()]]);
  const other = cand({ candidate_id: "gsc:other", facts: [{ name: "Impressions", value: 5555, source: "gsc" }] });
  const it = item({ why: "Together they have 4,100 and 5,555 impressions." });
  assert.ok(validateItem(it, byId, new Set(["/roof"]), []));
  assert.equal(validateItem(it, byId, new Set(["/roof"]), [], [other]), null);
});

test("score = gain (leads ×10) × confidence ÷ effort", () => {
  assert.equal(scoreOf(10, "High", "Low"), 10);
  assert.equal(scoreOf(10, "Medium", "Medium"), 3.75);
  assert.equal(weightedGain({ computed_gain: 2, gain_unit: "leads/mo" }), 20);
});

test("chunks keep a page's candidates together and stay at 12 or fewer", () => {
  const cs = Array.from({ length: 30 }, (_, i) => cand({ candidate_id: `c${i}`, page_url: `/p${i % 4}` }));
  const chunks = chunkCandidates(cs);
  assert.equal(chunks.flat().length, 30);
  assert.ok(chunks.every((c) => c.length <= 12));
  for (const p of ["/p0", "/p1", "/p2", "/p3"]) assert.equal(chunks.filter((c) => c.some((x) => x.page_url === p)).length, 1, `${p} in one chunk`);
});

test("scope picking: screen caps at 40, page and item select exactly", () => {
  const cs = Array.from({ length: 60 }, (_, i) => cand({ candidate_id: `c${i}`, page_url: i < 5 ? "/x" : "/y", computed_gain: i }));
  assert.equal(pickForScope(cs, { kind: "screen", screen: "gsc:pages" }).length, 40);
  assert.equal(pickForScope(cs, { kind: "page", url: "/x" }).length, 5);
  assert.deepEqual(pickForScope(cs, { kind: "item", key: "c7" }).map((c) => c.candidate_id), ["c7"]);
  assert.equal(pickForScope(cs, { kind: "site" })[0].computed_gain, 59, "ranked by gain");
});

test("settings: defaults, bad values ignored, cost per model", () => {
  const s = readSettings({ model: "gpt-x", effort: "turbo", monthlyBudget: -5, bannedWords: [" Free ", 3] });
  assert.equal(s.model, "claude-opus-5-5");
  assert.equal(s.effort, "medium");
  assert.equal(s.monthlyBudget, 20);
  assert.deepEqual(s.bannedWords, ["free"]);
  assert.equal(callCost("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 24);
  assert.equal(callCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 1_000_000 }, true), 1.05);
});

test("the output schema accepts a valid answer and rejects an unknown type", () => {
  assert.equal(QuickWinsSchema.safeParse({ items: [item()], merged: [] }).success, true);
  assert.equal(QuickWinsSchema.safeParse({ items: [{ ...item(), type: "Make it viral" }], merged: [] }).success, false);
});

test("batch custom_id matches the API pattern and keeps the chunk index readable", () => {
  for (const id of ["20261124080604mh6m", "run:with:colons", "x".repeat(80)]) {
    const c = batchCustomId(id, 7);
    assert.match(c, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(Number(c.split("-").pop()), 7);
  }
});

test("live results: the real site comes from the breadcrumb when Google wraps the link", () => {
  const wrapped = { type: "organic", domain: "google.com", url: "https://google.com/goto?url=CAES", breadcrumb: "https://www.fastsigns.com › galleria-tx › products › me..." };
  assert.equal(resultHost(wrapped), "fastsigns.com");
  assert.equal(resultUrl(wrapped), "https://www.fastsigns.com/galleria-tx/products");
  const plain = { type: "organic", domain: "www.example.com", url: "https://www.example.com/a/b", breadcrumb: "https://www.example.com › a › b" };
  assert.equal(resultHost(plain), "example.com");
  assert.equal(resultUrl(plain), "https://www.example.com/a/b");
});

test("keyword gaps: national volume counts in full only when the search names the business's city", () => {
  const settings = readSettings({});
  const gsc = { g: { settings: { cities: ["houston"], services: ["led signs", "channel letters"], brand: [] }, queries: () => new Map(), pages: () => new Map(), qp: () => [], p: { days: 28 }, isBrand: () => false, linksIn: new Map() }, wins: [], inv: [] };
  const gaps = { kw: [
    { keyword: "led signs houston", volume: 1000, difficulty: 10, intent: "commercial", their_position: 3, their_url: "https://x.com/a", their_traffic: 500, competitor: "x.com" },
    { keyword: "led signs", volume: 1000, difficulty: 10, intent: "commercial", their_position: 3, their_url: "https://x.com/b", their_traffic: 500, competitor: "x.com" },
  ], links: [], competitors: ["x.com"] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = buildCandidates({ settings, sources: ["dataforseo", "gsc"], gsc: gsc as any, ga4: null, kw: new Map(), serp: new Map(), gaps, local: { self: null, rivals: [] } });
  const named = r.all.find((c) => c.candidate_id === "dfs_keyword_gap:led signs houston")!;
  const plain = r.all.find((c) => c.candidate_id === "dfs_keyword_gap:led signs")!;
  assert.equal(named.computed_gain, 55, "1,000 × 5.5% in full");
  assert.equal(plain.computed_gain, 1.1, "1,000 × 5.5% × 2%");
});

/* ------------------------------------------------------------------ in-memory data cache: never stale */
function fakeDb(rows: { client_id: string; endpoint: string; params_hash: string; data: unknown; fetched_at: string }[]) {
  const calls = { heads: 0, data: 0 };
  const admin = {
    from: () => {
      let cols = "", filters: ((r: (typeof rows)[number]) => boolean)[] = [];
      const q = {
        select: (c: string) => { cols = c; return q; },
        eq: (k: string, v: string) => { filters.push((r) => (r as Record<string, unknown>)[k] === v); return q; },
        in: (k: string, vs: string[]) => {
          filters.push((r) => vs.includes((r as Record<string, unknown>)[k] as string));
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          filters = [];
          if (cols.includes("data")) { calls.data++; return Promise.resolve({ data: hit.map((r) => ({ params_hash: r.params_hash, data: r.data, fetched_at: r.fetched_at })), error: null }); }
          calls.heads++;
          return Promise.resolve({ data: hit.map((r) => ({ params_hash: r.params_hash, fetched_at: r.fetched_at })), error: null });
        },
      };
      return q;
    },
  };
  return { admin, calls };
}

test("data cache: reuses an unchanged row, re-downloads a rewritten one, drops a deleted one", async () => {
  const { cachedRows } = await import("@/lib/data-cache");
  const rows = [
    { client_id: "c-test", endpoint: "gscx", params_hash: "r:cube:q", data: { cols: ["q"], rows: [["a"]] }, fetched_at: "2026-11-24T01:00:00Z" },
    { client_id: "c-test", endpoint: "gscx", params_hash: "r:meta", data: { end: "2026-11-22" }, fetched_at: "2026-11-24T01:00:00Z" },
  ];
  const { admin, calls } = fakeDb(rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = () => cachedRows(admin as any, "c-test", "gscx", ["r:cube:q", "r:meta", "r:missing"]);
  const a = await read();
  assert.deepEqual([...a.keys()].sort(), ["r:cube:q", "r:meta"]);
  assert.deepEqual(calls, { heads: 0, data: 1 }, "first read: one query with the data");
  const b = await read();
  assert.equal(b.get("r:cube:q")!.data, a.get("r:cube:q")!.data, "same object from memory");
  assert.deepEqual(calls, { heads: 1, data: 1 }, "second read: only the version check");
  // a sync rewrites one row
  rows[0] = { ...rows[0], data: { cols: ["q"], rows: [["a"], ["b"]] }, fetched_at: "2026-11-24T09:00:00Z" };
  const c = await read();
  assert.deepEqual((c.get("r:cube:q")!.data as { rows: unknown[] }).rows.length, 2, "the new version is returned");
  assert.deepEqual(calls, { heads: 2, data: 2 }, "only the changed row is downloaded");
  // a row is deleted
  rows.splice(1, 1);
  const d = await read();
  assert.equal(d.has("r:meta"), false, "a deleted row is not returned from memory");
});
