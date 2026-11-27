import "server-only";
import type { Composio } from "@composio/core";
import { composioConfigProblem, composioFor, composioForClient, entityId } from "@/lib/composio/client";
import { platformBySocial } from "@/config/platforms";
import { ConfigError, configForClient, type OrgConfig } from "@/lib/org/config";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "./platforms";

/**
 * Social analytics through Composio: the Composio project of the client's organization (Settings → Integrations →
 * Composio) and the per-client entity "client:<id>", as for GA4 and Search Console. The client presses Connect,
 * logs in on the platform's own page (official OAuth), and the stats are read with Composio's read-only tools.
 * Nothing is posted.
 *
 * Composio provides its own OAuth app ("managed auth") for Facebook, Instagram, LinkedIn, Pinterest and
 * YouTube, so those work without any setup beyond the organization's Composio key. Threads, X and TikTok need an
 * auth config made in the organization's Composio project with its own developer app; its id can be saved as
 * COMPOSIO_AUTH_CONFIG_<PLATFORM>, or is found in the project automatically.
 */
export const TOOLKIT: Record<Platform, string> = {
  youtube: "youtube", facebook: "facebook", instagram: "instagram", tiktok: "tiktok",
  x: "twitter", linkedin: "linkedin", threads: "threads", pinterest: "pinterest",
};
const PLATFORM_OF = Object.fromEntries(Object.entries(TOOLKIT).map(([p, t]) => [t, p])) as Record<string, Platform>;
const MANAGED = new Set<Platform>(["facebook", "instagram", "linkedin", "pinterest", "youtube"]);
const configKey = (p: Platform) => `COMPOSIO_AUTH_CONFIG_${p === "x" ? "TWITTER" : p.toUpperCase()}`;

export { entityId };
export class SetupNeeded extends Error {}

/** The client shown on the current page (for callers that don't pass one). */
async function activeClientId(): Promise<string | null> {
  try {
    const { getSession } = await import("@/lib/analytics/client-context");
    return (await getSession()).client?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Readiness per platform for a client's organization: Connect can work when the platform has Composio-managed
 * login or the organization has an auth config for it (saved, or created in its Composio project, so adding one
 * there switches its Connect button on without a redeploy). Without a Composio key only the managed platforms
 * show Connect, which then explains what's missing. `clientId` defaults to the active client.
 */
export async function composioReadyMap(clientId?: string): Promise<Record<Platform, boolean>> {
  const id = clientId ?? (await activeClientId());
  const cfg = id ? await configForClient(id).catch(() => null) : null;
  const out = Object.fromEntries(PLATFORMS.map((p) => [p, MANAGED.has(p) || Boolean(cfg?.get(configKey(p)))])) as Record<Platform, boolean>;
  if (!cfg?.has("COMPOSIO_API_KEY") || PLATFORMS.every((p) => out[p])) return out;
  try {
    const list = await composioFor(cfg).authConfigs.list({ limit: 100 });
    for (const a of list.items) {
      const p = PLATFORMS.find((x) => TOOLKIT[x] === a.toolkit?.slug);
      if (p && a.status === "ENABLED") out[p] = true;
    }
  } catch { /* Composio unreachable or the key refused: the saved/managed answer stands */ }
  return out;
}
export const setupNote = (p: Platform) =>
  `${PLATFORM_INFO[p].label} has no Composio-managed login. Create a ${PLATFORM_INFO[p].label} developer app and add it as an auth config for the "${TOOLKIT[p]}" toolkit in your organization's Composio project; the Connect button appears here automatically.`;

/** The auth config for a platform: the organization's saved one, else an enabled one in its project, else a new Composio-managed one. */
async function authConfigFor(cfg: OrgConfig, c: Composio, p: Platform): Promise<string> {
  const saved = cfg.get(configKey(p));
  if (saved) return saved;
  const list = await c.authConfigs.list({ toolkit: TOOLKIT[p], limit: 20 });
  const found = list.items.find((a) => a.status === "ENABLED" && (a.toolkit?.slug ?? TOOLKIT[p]) === TOOLKIT[p]);
  if (found) return found.id;
  if (!MANAGED.has(p)) throw new SetupNeeded(setupNote(p));
  // read-only: only the scopes listed in the platform registry (src/config/platforms.ts), never Composio's broader defaults
  const scopes = platformBySocial(p)?.scopes.map((x) => x.scope) ?? [];
  const created = await c.authConfigs.create(TOOLKIT[p], { type: "use_composio_managed_auth", name: `${TOOLKIT[p]}-social-analytics-readonly`, ...(scopes.length ? { credentials: { scopes } } : {}) });
  return created.id;
}

/**
 * Starts the platform's login in the client organization's Composio project; returns the URL to send the browser
 * to. Missing or refused organization settings come back as SetupNeeded with what an owner must do.
 */
export async function startSocialConnect(clientId: string, p: Platform, callbackUrl: string): Promise<string> {
  try {
    const cfg = await configForClient(clientId);
    const c = composioFor(cfg);
    const req = await c.connectedAccounts.link(entityId(clientId), await authConfigFor(cfg, c, p), { callbackUrl });
    if (!req.redirectUrl) throw new Error("Composio didn't return a login link.");
    return req.redirectUrl;
  } catch (e) {
    if (e instanceof SetupNeeded) throw e;
    const problem = e instanceof ConfigError ? e : composioConfigProblem(e, configKey(p));
    if (problem) throw new SetupNeeded(problem.message, { cause: problem });
    throw e;
  }
}

export interface SocialConnection { platform: Platform; id: string; status: string; createdAt: string }

/** The client's Composio social accounts (newest per platform; ACTIVE preferred). */
export async function socialConnections(clientId: string): Promise<SocialConnection[]> {
  const c = await composioForClient(clientId);
  const res = await c.connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: Object.values(TOOLKIT), limit: 100 });
  const best = new Map<Platform, SocialConnection>();
  for (const a of [...res.items].sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
    const p = PLATFORM_OF[a.toolkit?.slug ?? ""];
    if (!p) continue;
    const cur = best.get(p);
    if (!cur || (cur.status !== "ACTIVE" && a.status === "ACTIVE")) best.set(p, { platform: p, id: a.id, status: a.status, createdAt: a.createdAt });
  }
  return [...best.values()];
}

/** Waits briefly for a just-finished login to turn ACTIVE (the redirect can beat Composio's status update). */
export async function settleConnection(clientId: string, p: Platform): Promise<SocialConnection | null> {
  let c = (await socialConnections(clientId)).find((x) => x.platform === p) ?? null;
  if (c && c.status !== "ACTIVE" && (c.status === "INITIATED" || c.status === "INITIALIZING")) {
    try { await (await composioForClient(clientId)).connectedAccounts.waitForConnection(c.id, 20_000); } catch { /* checked below */ }
    c = (await socialConnections(clientId)).find((x) => x.platform === p) ?? null;
  }
  return c;
}

/** Removes every Composio account of this platform for the client. */
export async function disconnectSocialAccount(clientId: string, p: Platform) {
  const c = await composioForClient(clientId);
  const res = await c.connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: [TOOLKIT[p]], limit: 50 });
  await Promise.all(res.items.map((a) => c.connectedAccounts.delete(a.id)));
}
