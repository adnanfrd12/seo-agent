// Run: npm test   (no network, no database: signatures, webhook endpoints and deleteConnection on an in-memory store)
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

const { parseSignedRequest, makeSignedRequest, verifyTikTokSignature, signTikTok, confirmationCode, CODE_RE } = await import("@/lib/compliance/signatures");
const { metaRoute, tiktokRoute } = await import("@/lib/compliance/webhooks");
const { allowLookup } = await import("@/lib/compliance/rate-limit");
const { PLATFORMS, publicPlatforms } = await import("@/config/platforms");

const SECRET = "test-app-secret";

/* ------------------------------------------------------------------ Meta signed_request */
test("signed_request: valid request is verified and user_id read", () => {
  const sr = makeSignedRequest({ algorithm: "HMAC-SHA256", user_id: "218471", issued_at: 1 }, SECRET);
  assert.equal(parseSignedRequest(sr, SECRET)?.user_id, "218471");
});
test("signed_request: tampered payload or wrong secret is rejected", () => {
  const sr = makeSignedRequest({ algorithm: "HMAC-SHA256", user_id: "218471" }, SECRET);
  const [sig] = sr.split(".");
  const forged = `${sig}.${Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "999" })).toString("base64url")}`;
  assert.equal(parseSignedRequest(forged, SECRET), null);
  assert.equal(parseSignedRequest(sr, "other-secret"), null);
  assert.equal(parseSignedRequest("garbage", SECRET), null);
  assert.equal(parseSignedRequest(sr, undefined), null);
});
test("signed_request: wrong algorithm is rejected", () => {
  assert.equal(parseSignedRequest(makeSignedRequest({ algorithm: "HMAC-SHA1", user_id: "1" }, SECRET), SECRET), null);
  assert.equal(parseSignedRequest(makeSignedRequest({ user_id: "1" }, SECRET), SECRET), null);
});

/* ------------------------------------------------------------------ TikTok signature */
test("TikTok signature: valid, tampered and stale", () => {
  const body = JSON.stringify({ event: "authorization.removed", user_openid: "abc" });
  const now = 1_800_000_000;
  const h = signTikTok(body, SECRET, now);
  assert.equal(verifyTikTokSignature(h, body, SECRET, now + 10), true);
  assert.equal(verifyTikTokSignature(h, body.replace("abc", "abd"), SECRET, now), false);
  assert.equal(verifyTikTokSignature(h, body, "other", now), false);
  assert.equal(verifyTikTokSignature(h, body, SECRET, now + 301), false, "older than 5 minutes");
  assert.equal(verifyTikTokSignature(null, body, SECRET, now), false);
});

test("confirmation codes are 12 URL-safe characters and unique", () => {
  const codes = new Set(Array.from({ length: 500 }, () => confirmationCode()));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, CODE_RE);
});

test("status lookups are rate limited per IP", () => {
  const t = Date.now();
  for (let i = 0; i < 10; i++) assert.equal(allowLookup("ip-a", t), true);
  assert.equal(allowLookup("ip-a", t), false);
  assert.equal(allowLookup("ip-b", t), true);
  assert.equal(allowLookup("ip-a", t + 61_000), true);
});

/* ------------------------------------------------------------------ endpoints (fake deletion service) */
function fakeDeps() {
  const calls: string[] = [];
  return { calls, deps: async () => ({
    deauthorize: async (p: string, uid: string) => { calls.push(`deauth:${p}:${uid}`); return 1; },
    deletionRequest: async (p: string, uid: string) => { calls.push(`delete:${p}:${uid}`); return "ABCDEFGHJKLM"; },
  }) };
}
const form = (sr: string) => new Request("https://x.test/hook", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ signed_request: sr }).toString() });

for (const [platform, kind] of [["facebook_pages", "deauthorize"], ["facebook_pages", "delete"], ["instagram", "deauthorize"], ["instagram", "delete"], ["threads", "deauthorize"], ["threads", "delete"]] as const) {
  test(`Meta ${platform} ${kind}: unsigned → 400, signed → handled`, async () => {
    const f = fakeDeps();
    const POST = metaRoute({ platform, kind, secret: () => SECRET, deps: f.deps });
    assert.equal((await POST(new Request("https://x.test/hook", { method: "POST" }))).status, 400);
    assert.equal((await POST(form(makeSignedRequest({ algorithm: "HMAC-SHA256", user_id: "42" }, "wrong")))).status, 400);
    const res = await POST(form(makeSignedRequest({ algorithm: "HMAC-SHA256", user_id: "42" }, SECRET)));
    assert.equal(res.status, 200);
    const body = await res.json();
    if (kind === "deauthorize") { assert.deepEqual(body, { success: true }); assert.deepEqual(f.calls, [`deauth:${platform}:42`]); }
    else {
      assert.equal(body.confirmation_code, "ABCDEFGHJKLM");
      assert.equal(body.url, "https://seoinsights.waheedzen.com/data-deletion/status?code=ABCDEFGHJKLM");
      assert.deepEqual(f.calls, [`delete:${platform}:42`]);
    }
  });
}

test("Meta endpoint rejects everything when the app secret is missing", async () => {
  const POST = metaRoute({ platform: "threads", kind: "delete", secret: () => undefined, deps: fakeDeps().deps });
  assert.equal((await POST(form(makeSignedRequest({ algorithm: "HMAC-SHA256", user_id: "42" }, SECRET)))).status, 400);
});

test("TikTok webhook: unsigned → 400, authorization.removed → deletion, other events → 200 only", async () => {
  const f = fakeDeps();
  const now = 1_800_000_000;
  const POST = tiktokRoute({ secret: () => SECRET, deps: f.deps, now: () => now });
  const send = (body: string, sig: string | null) => POST(new Request("https://x.test/tt", { method: "POST", headers: sig ? { "TikTok-Signature": sig } : {}, body }));
  const removed = JSON.stringify({ client_key: "k", event: "authorization.removed", create_time: now, user_openid: "open-1", content: "{\"reason\":1}" });
  assert.equal((await send(removed, null)).status, 400);
  assert.equal((await send(removed, signTikTok(removed, "wrong", now))).status, 400);
  assert.equal((await send(removed, signTikTok(removed, SECRET, now))).status, 200);
  const other = JSON.stringify({ event: "video.publish.completed", user_openid: "open-1" });
  assert.equal((await send(other, signTikTok(other, SECRET, now))).status, 200);
  assert.deepEqual(f.calls, ["delete:tiktok:open-1"]);
});

/* ------------------------------------------------------------------ registry */
test("registry: required platforms are public and in review or live; scopes have reasons", () => {
  for (const id of ["threads", "x", "tiktok", "pinterest"]) assert.ok(["in_review", "live"].includes(PLATFORMS.find((p) => p.id === id)!.status), id);
  assert.ok(publicPlatforms().every((p) => p.status !== "planned"));
  for (const p of PLATFORMS) { assert.ok(p.scopes.length && p.scopes.every((s) => s.reason.length > 10), p.id); assert.equal(p.readOnly, true); }
  const meta = PLATFORMS.filter((p) => p.deletionNotification === "meta_signed_request").map((p) => p.id).sort();
  assert.deepEqual(meta, ["facebook_pages", "instagram", "threads"]);
});

/* ------------------------------------------------------------------ deleteConnection on an in-memory database */
type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]>) {
  const db: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const cascade = () => { // ON DELETE CASCADE from integration_connections and integration_resources
    const conns = new Set((db.integration_connections ?? []).map((r) => r.id));
    for (const t of ["integration_resources", "integration_secrets"]) db[t] = (db[t] ?? []).filter((r) => conns.has(r.connection_id));
    const res = new Set((db.integration_resources ?? []).map((r) => r.id));
    db.bing_daily_metrics = (db.bing_daily_metrics ?? []).filter((r) => res.has(r.resource_id));
  };
  function from(table: string) {
    db[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "delete" | "update" | "insert" = "select";
    let patch: Row = {};
    const q = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      like: (k: string, p: string) => { const re = new RegExp(`^${p.replace(/%/g, ".*")}$`); filters.push((r) => re.test(String(r[k]))); return q; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      not: () => q, limit: () => q,
      delete: () => { op = "delete"; return q; }, update: (p: Row) => { op = "update"; patch = p; return q; },
      insert: (r: Row) => { db[table].push({ ...r }); return Promise.resolve({ error: null }); },
      maybeSingle: () => Promise.resolve(run(true)),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(ok, bad),
    };
    function run(single: boolean) {
      const hit = db[table].filter((r) => filters.every((f) => f(r)));
      if (op === "delete") { db[table] = db[table].filter((r) => !hit.includes(r)); cascade(); return { data: hit, error: null }; }
      if (op === "update") { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { db, admin: { from, storage: { createBucket: async () => ({ error: null }), from: () => ({}) } } };
}

test("deleteConnection removes the key and all data, logs IDs only, and is idempotent", async () => {
  const { deleteConnection } = await import("@/lib/compliance/deletion");
  const { db, admin } = fakeDb({
    clients: [{ id: "c1", settings: { platform_accounts: { bing_webmaster: { user_id: "u1", ids: {} } } } }],
    integration_connections: [{ id: "conn-1", client_id: "c1", provider: "bing" }, { id: "conn-2", client_id: "c1", provider: "clarity" }],
    integration_secrets: [{ connection_id: "conn-1", refresh_token_encrypted: "enc" }, { connection_id: "conn-2", refresh_token_encrypted: "enc2" }],
    integration_resources: [{ id: "r1", connection_id: "conn-1" }, { id: "r2", connection_id: "conn-2" }],
    bing_daily_metrics: [{ resource_id: "r1", clicks: 5 }, { resource_id: "r1", clicks: 7 }],
    data_deletion_log: [],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any;
  const first = await deleteConnection(a, "conn-1", "dashboard");
  assert.equal(first.deleted, true);
  assert.equal(db.integration_connections.length, 1, "only the Bing connection is gone");
  assert.equal(db.integration_secrets.filter((s) => s.connection_id === "conn-1").length, 0, "token/key deleted");
  assert.equal(db.integration_resources.filter((r) => r.connection_id === "conn-1").length, 0);
  assert.equal(db.bing_daily_metrics.length, 0, "metrics deleted");
  assert.equal(db.integration_secrets.length, 1, "other connections untouched");
  assert.deepEqual((db.clients[0].settings as { platform_accounts: object }).platform_accounts, {}, "stored platform IDs forgotten");
  assert.equal(db.data_deletion_log.length, 1);
  const log = db.data_deletion_log[0];
  assert.deepEqual(Object.keys(log).sort(), ["action", "at", "connection_ref", "detail", "platform", "platform_user_id", "reason", "workspace_id"]);
  const second = await deleteConnection(a, "conn-1", "dashboard");
  assert.equal(second.deleted, false, "second run is a no-op");
  assert.equal(db.data_deletion_log.length, 1);
});
