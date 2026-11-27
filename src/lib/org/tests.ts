import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic as anthropicClient } from "@/lib/ai/claude";
import { composioFor } from "@/lib/composio/client";
import { orgConfig, type OrgConfig } from "./config";
import { integrationById } from "./registry";

/**
 * Connection tests for the Integrations tab: one cheap, read-only call per integration, made with the
 * organization's own configuration (its stored credentials; for the first organization, the server environment
 * while it still falls back to it). Nothing is written anywhere and nothing is billed (YouTube spends 1 of its
 * 10,000 free daily quota units).
 *
 * The message is plain text for the UI. Credential values never appear in it: every value of the integration is
 * scrubbed from it, upstream error text included, and URLs that carry a key are never echoed.
 */
export type TestStatus = "ok" | "warning" | "error";
export interface TestResult {
  /** false only for "error"; a warning means it works with a caveat */
  ok: boolean;
  status: TestStatus;
  message: string;
  ms: number;
}
type Outcome = { status: TestStatus; message: string };

const TIMEOUT_MS = 15_000;
const ok = (message: string): Outcome => ({ status: "ok", message });
const warn = (message: string): Outcome => ({ status: "warning", message });
const fail = (message: string): Outcome => ({ status: "error", message });

class Timeout extends Error {}
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new Timeout();
    throw e;
  }
}
const json = async (res: Response): Promise<Record<string, unknown>> => {
  const v: unknown = await res.json().catch(() => null);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ Anthropic: list one model (free) */
async function anthropic(cfg: OrgConfig): Promise<Outcome> {
  // the app's shared client for this organization's key (authToken: null), without retries for a quick answer
  const client = anthropicClient(cfg).withOptions({ maxRetries: 0, timeout: TIMEOUT_MS });
  try {
    const page = await client.models.list({ limit: 1 });
    const model = page.data[0]?.display_name;
    return ok(`Connected: the key can use the Claude API${model ? ` (models such as ${model} are available)` : ""}.`);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail("Anthropic rejected the API key. Create a new key in the Anthropic Console (Settings → API keys) and save it here.");
    if (e instanceof Anthropic.PermissionDeniedError) return fail("The key isn't allowed to use the API. Check its workspace and organization in the Anthropic Console.");
    if (e instanceof Anthropic.RateLimitError) return warn("The key works, but Anthropic is rate limiting it right now. Try again in a minute.");
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new Timeout();
    if (e instanceof Anthropic.APIConnectionError) return fail("Couldn't reach Anthropic. Try again.");
    if (e instanceof Anthropic.APIError) return fail(`Anthropic answered with an error (${e.status ?? "no status"}). Try again later.`);
    throw e;
  }
}

/* ------------------------------------------------------------------ DataForSEO: account data (free) */
async function dataforseo(cfg: OrgConfig): Promise<Outcome> {
  const basic = Buffer.from(`${cfg.require("DATAFORSEO_LOGIN")}:${cfg.require("DATAFORSEO_PASSWORD")}`).toString("base64");
  const res = await call("https://api.dataforseo.com/v3/appendix/user_data", { headers: { Authorization: `Basic ${basic}` } });
  if (res.status === 401) return fail("DataForSEO rejected the login and API password. Use the API password from DataForSEO → API Access, not your account password.");
  const body = await json(res);
  const task = obj((Array.isArray(body.tasks) ? body.tasks : [])[0]);
  const code = Number(task.status_code ?? body.status_code ?? res.status);
  if (code === 20000) {
    const result = obj((Array.isArray(task.result) ? task.result : [])[0]);
    const balance = obj(result.money).balance;
    return typeof balance === "number"
      ? (balance <= 0 ? warn("Connected, but the DataForSEO balance is $0.00: add credit before running paid requests.") : ok(`Connected. Account balance $${balance.toFixed(2)}.`))
      : ok("Connected.");
  }
  if (code === 40100) return fail("DataForSEO rejected the login and API password.");
  if (code === 40104) return fail("DataForSEO says the account isn't verified yet. Please verify your account (check the email from DataForSEO, or log in to app.dataforseo.com and finish verification), then test again.");
  if (code === 40207) return fail("DataForSEO refused this server's IP address: it isn't whitelisted. Allow all IPs (or add this server's IP) in DataForSEO → API Access.");
  return fail(`DataForSEO: ${String(task.status_message ?? body.status_message ?? `HTTP ${res.status}`).slice(0, 160)} (${code}).`);
}

/* ------------------------------------------------------------------ Google OAuth app: client ID format + token endpoint */
const GOOGLE_CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
async function googleOauth(cfg: OrgConfig): Promise<Outcome> {
  const clientId = cfg.require("GOOGLE_GBP_CLIENT_ID");
  if (!GOOGLE_CLIENT_ID.test(clientId)) return fail("The client ID doesn't look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).");
  const redirect = cfg.get("GOOGLE_GBP_REDIRECT_URI");
  if (redirect) {
    let u: URL | null = null;
    try { u = new URL(redirect); } catch { /* checked below */ }
    if (!u || (u.protocol !== "https:" && u.hostname !== "localhost")) return fail("The redirect URI override must be a full https:// address (or leave it empty).");
  }
  // A refresh with a made-up token: Google answers invalid_grant when the client ID and secret are right,
  // invalid_client / unauthorized_client when they aren't. No user is involved and nothing is created.
  const res = await call("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: cfg.require("GOOGLE_GBP_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: "seo-insights-connection-test" }),
  });
  const error = String((await json(res)).error ?? "");
  if (error === "invalid_grant") return ok("Google accepted the client ID and secret. Make sure the redirect URI shown here is listed on the OAuth client.");
  if (error === "invalid_client" || error === "unauthorized_client") return fail("Google rejected the client ID or secret. Copy both again from Google Cloud → APIs & Services → Credentials.");
  return fail(`Google answered unexpectedly (${error || `HTTP ${res.status}`}). Try again.`);
}

/* ------------------------------------------------------------------ Google API keys: one free request per key */
function googleKeyProblem(status: number, body: Record<string, unknown>): "invalid" | "denied" | "quota" | "other" {
  const e = obj(body.error);
  const reasons = [
    ...(Array.isArray(e.details) ? e.details : []).map((d) => String(obj(d).reason ?? "")),
    ...(Array.isArray(e.errors) ? e.errors : []).map((d) => String(obj(d).reason ?? "")),
  ];
  if (reasons.includes("API_KEY_INVALID") || /api key not valid/i.test(String(e.message ?? ""))) return "invalid";
  if (status === 429 || reasons.some((r) => /quota|rateLimit|RATE_LIMIT/i.test(r))) return "quota";
  if (status === 403) return "denied";
  return "other";
}

async function probeKey(key: string, api: "crux" | "youtube"): Promise<{ status: number; body: Record<string, unknown> }> {
  // the key goes in a header, never in a URL that could end up in a log
  const res = api === "crux"
    ? await call("https://chromeuxreport.googleapis.com/v1/records:queryRecord", {
        method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ origin: "https://www.google.com" }),
      })
    : await call("https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&id=1", { headers: { "x-goog-api-key": key } });
  return { status: res.status, body: await json(res) };
}

async function googleApi(cfg: OrgConfig): Promise<Outcome> {
  const checks: { key: string; label: string; api: "crux" | "youtube"; apiName: string; essential: boolean }[] = [
    // GOOGLE_API_KEY mainly names the Cloud project for Business Profile quotas; Chrome UX Report is a bonus
    { key: "GOOGLE_API_KEY", label: "Google API key", api: "crux", apiName: "Chrome UX Report API", essential: false },
    { key: "PAGESPEED_API_KEY", label: "PageSpeed key", api: "crux", apiName: "Chrome UX Report API", essential: true },
    { key: "YOUTUBE_API_KEY", label: "YouTube key", api: "youtube", apiName: "YouTube Data API v3", essential: true },
  ];
  const present = checks.filter((c) => cfg.get(c.key));
  if (!present.length) return fail("Add at least one key first.");
  const results = await Promise.all(present.map(async (c): Promise<Outcome> => {
    const { status, body } = await probeKey(cfg.get(c.key)!, c.api);
    if (status === 200 || (c.api === "crux" && status === 404)) return ok(`${c.label}: works with the ${c.apiName}.`);
    const problem = googleKeyProblem(status, body);
    if (problem === "invalid") return fail(`${c.label}: Google says the key isn't valid.`);
    if (problem === "quota") return warn(`${c.label}: valid, but its daily quota is used up for now.`);
    if (problem === "denied") {
      const fix = `enable the ${c.apiName} in the key's Google Cloud project and allow it in the key's API restrictions`;
      return c.essential ? fail(`${c.label}: valid, but it can't call the ${c.apiName}: ${fix}.`) : warn(`${c.label}: valid, but it can't call the ${c.apiName} (to use it for real-user speed data, ${fix}).`);
    }
    return fail(`${c.label}: Google answered ${status}.`);
  }));
  const status: TestStatus = results.some((r) => r.status === "error") ? "error" : results.some((r) => r.status === "warning") ? "warning" : "ok";
  return { status, message: results.map((r) => r.message).join(" ") };
}

/* ------------------------------------------------------------------ Composio: list auth configs */
const COMPOSIO_CONFIGS: [string, string][] = [
  ["COMPOSIO_AUTH_CONFIG_GA4", "Google Analytics"], ["COMPOSIO_AUTH_CONFIG_GSC", "Search Console"],
  ["COMPOSIO_AUTH_CONFIG_FACEBOOK", "Facebook"], ["COMPOSIO_AUTH_CONFIG_INSTAGRAM", "Instagram"], ["COMPOSIO_AUTH_CONFIG_THREADS", "Threads"],
  ["COMPOSIO_AUTH_CONFIG_TIKTOK", "TikTok"], ["COMPOSIO_AUTH_CONFIG_TWITTER", "X (Twitter)"], ["COMPOSIO_AUTH_CONFIG_LINKEDIN", "LinkedIn"],
  ["COMPOSIO_AUTH_CONFIG_PINTEREST", "Pinterest"], ["COMPOSIO_AUTH_CONFIG_YOUTUBE", "YouTube"],
];
const composioAuthError = (e: unknown) => /\b401\b|\b403\b|unauthori[sz]ed|invalid api key|api key.*(invalid|not found)|forbidden/i.test(e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e));

async function within<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Timeout()), TIMEOUT_MS); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function composio(cfg: OrgConfig): Promise<Outcome> {
  // the app's shared client for this organization's key (it never falls back to the SDK's environment variables)
  const c = composioFor(cfg);
  let total: number;
  try {
    total = (await within(c.authConfigs.list({ limit: 50 }))).items.length;
  } catch (e) {
    if (e instanceof Timeout) throw e;
    return composioAuthError(e) ? fail("Composio rejected the API key. Copy it again from Composio → Settings → API keys.") : fail("Couldn't read the Composio project. Try again.");
  }
  const wanted = COMPOSIO_CONFIGS.filter(([k]) => cfg.get(k));
  const found = await Promise.all(wanted.map(async ([k, label]) => {
    try {
      const a = await within(c.authConfigs.get(cfg.get(k)!));
      return { label, state: a.status === "DISABLED" ? "disabled" as const : "ok" as const };
    } catch (e) {
      if (e instanceof Timeout) throw e;
      return { label, state: "missing" as const };
    }
  }));
  const missing = found.filter((f) => f.state === "missing").map((f) => f.label);
  const disabled = found.filter((f) => f.state === "disabled").map((f) => f.label);
  if (missing.length) return fail(`The API key works, but these auth config IDs aren't in its Composio project: ${missing.join(", ")}.`);
  if (disabled.length) return warn(`Connected, but these auth configs are disabled in Composio: ${disabled.join(", ")}.`);
  const named = found.map((f) => f.label);
  return ok(`Connected. ${plural(total, "auth config")} in the project${named.length ? `; ${named.join(", ")} found and enabled` : ""}.`);
}

/* ------------------------------------------------------------------ Local Brand Manager: first page of locations */
async function lbm(cfg: OrgConfig): Promise<Outcome> {
  const token = cfg.require("LOCAL_BRAND_MANAGER_API_TOKEN").replace(/^Token\s+/i, "").trim();
  // one location is enough to prove access (LBM can be slow to send long pages)
  const res = await call("https://api.localbrandmanager.com/locations?per=1&page=1", { headers: { Authorization: `Token ${token}`, Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) return fail("Local Brand Manager rejected the API token. Create a new one at app.localbrandmanager.com/api_tokens.");
  if (res.status === 429) return warn("The token works, but Local Brand Manager is rate limiting it right now.");
  if (!res.ok) return fail(`Local Brand Manager answered ${res.status}. Try again.`);
  const list: unknown = await res.json().catch(() => null);
  // an unreadable body still means the token was accepted
  if (!Array.isArray(list)) return ok("Connected: Local Brand Manager accepted the token.");
  return list.length ? ok("Connected: the token can read your locations.") : warn("Connected, but the account has no locations yet.");
}

/* ------------------------------------------------------------------ SEOSignalX: MCP session + list projects */
async function seosignalx(cfg: OrgConfig): Promise<Outcome> {
  const token = cfg.require("SEOSIGNALX_MCP_TOKEN").replace(/^Bearer\s+/i, "").trim();
  let sid: string | null = null;
  const rpc = async (body: Record<string, unknown>) => {
    const res = await call("https://seosignalx.com/api/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
    sid = res.headers.get("mcp-session-id") ?? sid;
    const text = await res.text();
    return { status: res.status, text };
  };
  const init = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "seo-insights", version: "1.0" } } });
  if (init.status === 401 || init.status === 403) return fail("SEOSignalX rejected the MCP token. Generate a new one in SEOSignalX → MCP.");
  if (init.status >= 400) return fail(`SEOSignalX answered ${init.status}. Try again.`);
  await rpc({ method: "notifications/initialized", params: {} });
  const r = await rpc({ id: 2, method: "tools/call", params: { name: "seosignalx_list_projects", arguments: {} } });
  if (r.status === 401 || r.status === 403) return fail("SEOSignalX rejected the MCP token. Generate a new one in SEOSignalX → MCP.");
  try {
    const msg = JSON.parse(/^data: (.*)$/m.exec(r.text)?.[1] ?? r.text) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: unknown };
    if (msg.error || msg.result?.isError) return fail("SEOSignalX accepted the token but couldn't list your projects. Try again.");
    const inner = JSON.parse((msg.result?.content ?? []).map((c) => c.text ?? "").join("") || "{}") as { projects?: unknown[] };
    const n = inner.projects?.length ?? 0;
    return n ? ok(`Connected. ${plural(n, "project")} in SEOSignalX.`) : warn("Connected, but there are no projects in SEOSignalX yet.");
  } catch {
    return fail("SEOSignalX answered in an unexpected format. Try again.");
  }
}

/* ------------------------------------------------------------------ Bing Webmaster Tools: the account's sites */
async function bing(cfg: OrgConfig): Promise<Outcome> {
  const key = cfg.require("BING_WEBMASTER_API_KEY").trim();
  const res = await call(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(key)}`);
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403 || /InvalidApiKey|NotAuthorized/i.test(text)) return fail("Bing rejected the API key. Generate a new one in Bing Webmaster Tools → Settings → API access.");
  if (res.status === 429 || /ThrottleUser|quota/i.test(text)) return warn("The key works, but Bing is rate limiting it right now.");
  if (!res.ok) return fail(`Bing answered ${res.status}. Try again.`);
  let sites: { IsVerified?: boolean }[] = [];
  try { sites = (JSON.parse(text) as { d?: { IsVerified?: boolean }[] }).d ?? []; } catch { /* empty answer */ }
  const verified = sites.filter((s) => s.IsVerified).length;
  return sites.length ? ok(`Connected. ${plural(sites.length, "site")} in the account (${verified} verified).`) : warn("Connected, but the Bing account has no sites yet.");
}

const TESTS: Record<string, (cfg: OrgConfig) => Promise<Outcome>> = {
  anthropic, dataforseo, google_oauth: googleOauth, google_api: googleApi, composio, lbm, seosignalx, bing,
};

/** Whether the Integrations tab offers "Test connection" for this integration. */
export const hasTest = (integrationId: string) => integrationId in TESTS;

/** Removes every value the integration uses (and their URL-encoded forms) from a message. */
export function scrub(text: string, values: (string | undefined)[]): string {
  let out = text;
  for (const v of values) {
    if (!v || v.length < 4) continue;
    for (const form of new Set([v, encodeURIComponent(v)])) out = out.split(form).join("••••");
  }
  return out.slice(0, 400);
}

/**
 * Runs the connection test for one integration with the given organization configuration. Always resolves; the
 * message is safe to show (no credential values). `cfg` is for scripts and tests (staticConfig).
 */
export async function runTest(cfg: OrgConfig, integrationId: string): Promise<TestResult> {
  const started = Date.now();
  const def = integrationById(integrationId);
  const done = (o: Outcome): TestResult => ({
    ok: o.status !== "error", status: o.status, ms: Date.now() - started,
    message: scrub(o.message, (def?.fields ?? []).map((f) => cfg.get(f.key))),
  });
  const test = TESTS[integrationId];
  if (!def || !test) return done(fail("There's no connection test for this integration."));
  const missing = def.fields.filter((f) => f.required && !cfg.get(f.key));
  if (missing.length) return done(fail(`Add the ${missing.map((f) => f.label).join(" and ")} first.`));
  try {
    return done(await test(cfg));
  } catch (e) {
    if (e instanceof Timeout) return done(fail(`${def.name} didn't answer within ${TIMEOUT_MS / 1000} seconds. Try again.`));
    // unexpected failures: a generic message (an exception's text could quote a request)
    return done(fail(`The test couldn't reach ${def.name}. Try again.`));
  }
}

/** Runs the connection test for one integration of an organization (its own configuration only). */
export async function testIntegration(orgId: string, integrationId: string): Promise<TestResult> {
  return runTest(await orgConfig(orgId), integrationId);
}
