import "server-only";
import { Composio } from "@composio/core";
import { serverEnv } from "@/lib/env";

let instance: Composio | null = null;

export function composio(): Composio {
  if (!instance) instance = new Composio({ apiKey: serverEnv().COMPOSIO_API_KEY });
  return instance;
}

export class ProviderAuthError extends Error {
  readonly kind = "auth";
}
export class ProviderRateLimitError extends Error {
  readonly kind = "rate_limit";
}

const AUTH_RE = /(401|403|invalid[_ ]grant|unauthori[sz]ed|token.*(expired|revoked)|reauth)/i;
const RATE_RE = /(429|rate.?limit|quota)/i;

/**
 * A read-only GET to the platform's own API through Composio's proxy, signed with the connected account's
 * login (for endpoints Composio has no tool for). Same typed errors as executeTool.
 */
export async function proxyGet(a: { connectedAccountId: string; url: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<unknown> {
  const call = composio().tools.proxyExecute({
    endpoint: a.url, method: "GET", connectedAccountId: a.connectedAccountId,
    parameters: Object.entries(a.headers ?? {}).map(([name, value]) => ({ in: "header" as const, name, value })),
  });
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`GET ${new URL(a.url).pathname} timed out`)), a.timeoutMs ?? 60_000));
  const res = await Promise.race([call, timeout]);
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

interface ExecuteArgs {
  slug: string;
  toolkitVersionEnv?: string;
  connectedAccountId: string;
  userId: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Execute a Composio tool and return its `data` payload. Raises typed errors so the
 * sync worker can decide between retry (rate limit / transient) and "reconnect" (auth).
 * Error text is sanitised: tool arguments and tokens are never logged.
 */
export async function executeTool(a: ExecuteArgs): Promise<unknown> {
  const timeoutMs = a.timeoutMs ?? 60_000;
  const call = composio().tools.execute(a.slug, {
    userId: a.userId,
    connectedAccountId: a.connectedAccountId,
    arguments: a.arguments,
    ...(a.toolkitVersionEnv
      ? { version: a.toolkitVersionEnv }
      : { dangerouslySkipVersionCheck: true }),
  });
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`${a.slug} timed out after ${timeoutMs}ms`)), timeoutMs),
  );
  const res = await Promise.race([call, timeout]);
  if (!res.successful) {
    const msg = String(res.error ?? "tool call failed").slice(0, 500);
    if (RATE_RE.test(msg)) throw new ProviderRateLimitError(msg);
    if (AUTH_RE.test(msg)) throw new ProviderAuthError(msg);
    throw new Error(`${a.slug}: ${msg}`);
  }
  return res.data;
}
