import "server-only";
import { createHash } from "node:crypto";
import { Composio } from "@composio/core";
import { ConfigError, configForClient, orgConfig, type OrgConfig } from "@/lib/org/config";
import { integrationById } from "@/lib/org/registry";

/**
 * Composio per organization. Each organization connects its clients' Google Analytics, Search Console and social
 * logins through its own Composio project (COMPOSIO_API_KEY and auth config IDs in Settings → Integrations), and
 * every call for a client uses the project of the organization that client belongs to. A missing key is a
 * ConfigError: never another organization's key, and never the SDK's own fallback to the COMPOSIO_API_KEY
 * environment variable. A client's accounts live under the entity "client:<clientId>" in that project, so the
 * accounts connected before organizations existed keep working for the first organization.
 */
const clients = new Map<string, Composio>();

/** The Composio SDK client for an organization's configuration (one per API key, reused across requests). */
export function composioFor(cfg: OrgConfig): Composio {
  const apiKey = cfg.require("COMPOSIO_API_KEY");
  const id = createHash("sha256").update(apiKey).digest("hex");
  let c = clients.get(id);
  if (!c) {
    // Everything explicit: the SDK would otherwise read COMPOSIO_API_KEY / COMPOSIO_USER_API_KEY /
    // COMPOSIO_ORG_API_KEY and COMPOSIO_TOOLKIT_VERSION_* from the server environment for every organization.
    // Toolkit versions are passed per call instead (executeTool).
    c = new Composio({ apiKey, userApiKey: null, orgApiKey: null, toolkitVersions: "latest", disableVersionCheck: true });
    if (clients.size >= 100) clients.delete(clients.keys().next().value!);
    clients.set(id, c);
  }
  return c;
}

/** The Composio client of the client's organization (ConfigError when that organization hasn't set Composio up). */
export async function composioForClient(clientId: string): Promise<Composio> {
  return composioFor(await configForClient(clientId));
}

export async function composioForOrg(orgId: string): Promise<Composio> {
  return composioFor(await orgConfig(orgId));
}

/** Composio "user id" (entity) of a client: one per client keeps every client's accounts apart. */
export const entityId = (clientId: string) => `client:${clientId}`;
const ENTITY = /^client:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The client an entity belongs to, which decides the organization (and so the Composio project) of every call. */
export function clientOfEntity(userId: string): string {
  const m = ENTITY.exec(userId);
  if (!m) throw new Error("Unknown Composio user: expected client:<id>.");
  return m[1];
}

export class ProviderAuthError extends Error {
  readonly kind = "auth";
}
export class ProviderRateLimitError extends Error {
  readonly kind = "rate_limit";
}

const AUTH_RE = /(401|403|invalid[_ ]grant|unauthori[sz]ed|token.*(expired|revoked)|reauth)/i;
const RATE_RE = /(429|rate.?limit|quota)/i;

/** "Google Analytics auth config ID", as the Integrations tab names the field */
const fieldLabel = (key: string) => integrationById("composio")?.fields.find((f) => f.key === key)?.label ?? key;

/**
 * Composio's own refusals that only the organization's settings can fix, as a ConfigError with a message for the
 * user (the raw error text is never passed on: it can echo part of the key). Null for anything else.
 *  - the project API key is invalid or was deleted (HTTP 401 from Composio itself, not from the platform)
 *  - the auth config ID saved for this organization isn't in its project (`authConfigKey` names which one)
 */
export function composioConfigProblem(e: unknown, authConfigKey?: string): ConfigError | null {
  if (e instanceof ConfigError) return e;
  const err = e as { status?: unknown; message?: unknown; cause?: { status?: unknown; message?: unknown } } | null;
  const status = Number(err?.status ?? err?.cause?.status ?? 0);
  const text = `${String(err?.message ?? "")} ${String(err?.cause?.message ?? "")}`;
  if (status === 401 || /APIKey_InvalidAPIKey|invalid api key/i.test(text)) {
    return new ConfigError("composio", ["COMPOSIO_API_KEY"], "Composio rejected this organization's API key. An owner can save a current key in Settings → Integrations → Composio.");
  }
  if (authConfigKey && /auth.?config/i.test(text) && (status === 404 || status === 400 || /not.?found|does not exist|invalid/i.test(text))) {
    return new ConfigError("composio", [authConfigKey], `Composio couldn't find the ${fieldLabel(authConfigKey)} saved for this organization. An owner can check that it belongs to the same Composio project as the API key, in Settings → Integrations → Composio.`);
  }
  return null;
}

/** Rejects after `ms`, and stops the timer when the call settles first (so it never keeps a process alive). */
async function within<T>(call: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([call, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A read-only GET to the platform's own API through Composio's proxy, signed with the connected account's
 * login (for endpoints Composio has no tool for). `userId` is the account's entity (client:<id>), which picks the
 * organization's project. Same typed errors as executeTool.
 */
export async function proxyGet(a: { userId: string; connectedAccountId: string; url: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<unknown> {
  const c = await composioForClient(clientOfEntity(a.userId));
  const res = await within(c.tools.proxyExecute({
    endpoint: a.url, method: "GET", connectedAccountId: a.connectedAccountId,
    parameters: Object.entries(a.headers ?? {}).map(([name, value]) => ({ in: "header" as const, name, value })),
  }), a.timeoutMs ?? 60_000, `GET ${new URL(a.url).pathname}`).catch((e: unknown) => { throw composioConfigProblem(e) ?? e; });
  const status = Number((res as { status?: number }).status ?? 200);
  const data = (res as { data?: unknown }).data;
  if (status >= 400) {
    const msg = `HTTP ${status}: ${JSON.stringify(data ?? "").slice(0, 300)}`;
    if (status === 429 || RATE_RE.test(msg)) throw new ProviderRateLimitError(msg);
    if (status === 401) throw new ProviderAuthError(msg);
    throw new Error(msg);
  }
  return data;
}

/** Toolkit versions an organization can pin (Settings → Integrations → Composio), by tool slug prefix. */
const VERSION_KEYS: [prefix: string, key: string][] = [
  ["GOOGLE_ANALYTICS_", "COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS"],
  ["GOOGLE_SEARCH_CONSOLE_", "COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE"],
];
const versionFor = (cfg: OrgConfig, slug: string) => {
  const key = VERSION_KEYS.find(([prefix]) => slug.startsWith(prefix))?.[1];
  return key ? cfg.get(key) : undefined;
};

interface ExecuteArgs {
  slug: string;
  /** @deprecated ignored: the toolkit version is the client organization's own setting (COMPOSIO_TOOLKIT_VERSION_*) */
  toolkitVersionEnv?: string;
  connectedAccountId: string;
  /** the account's entity, client:<id>: it also decides which organization's Composio project runs the call */
  userId: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Execute a Composio tool and return its `data` payload. Raises typed errors so the
 * sync worker can decide between retry (rate limit / transient) and "reconnect" (auth);
 * a ConfigError when the organization's Composio settings are missing or refused.
 * Error text is sanitised: tool arguments and tokens are never logged.
 */
export async function executeTool(a: ExecuteArgs): Promise<unknown> {
  const timeoutMs = a.timeoutMs ?? 60_000;
  const cfg = await configForClient(clientOfEntity(a.userId));
  const version = versionFor(cfg, a.slug);
  const res = await within(composioFor(cfg).tools.execute(a.slug, {
    userId: a.userId,
    connectedAccountId: a.connectedAccountId,
    arguments: a.arguments,
    ...(version ? { version } : { dangerouslySkipVersionCheck: true }),
  }), timeoutMs, a.slug).catch((e: unknown) => { throw composioConfigProblem(e) ?? e; });
  if (!res.successful) {
    const msg = String(res.error ?? "tool call failed").slice(0, 500);
    if (RATE_RE.test(msg)) throw new ProviderRateLimitError(msg);
    if (AUTH_RE.test(msg)) throw new ProviderAuthError(msg);
    throw new Error(`${a.slug}: ${msg}`);
  }
  return res.data;
}
