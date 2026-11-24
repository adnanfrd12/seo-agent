import "server-only";
import { composio } from "@/lib/composio/client";
import { platformBySocial } from "@/config/platforms";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "./platforms";

/**
 * Social analytics through Composio (the same account and per-client entity "client:<id>" used for GA4 and
 * Search Console). The client presses Connect, logs in on the platform's own page (official OAuth), and the
 * stats are read with Composio's read-only tools. Nothing is posted.
 *
 * Composio provides its own OAuth app ("managed auth") for Facebook, Instagram, LinkedIn, Pinterest and
 * YouTube, so those work without any setup. Threads, X and TikTok need an auth config made in the Composio
 * dashboard with the agency's own developer app; its id goes in COMPOSIO_AUTH_CONFIG_<PLATFORM>.
 */
export const TOOLKIT: Record<Platform, string> = {
  youtube: "youtube", facebook: "facebook", instagram: "instagram", tiktok: "tiktok",
  x: "twitter", linkedin: "linkedin", threads: "threads", pinterest: "pinterest",
};
const PLATFORM_OF = Object.fromEntries(Object.entries(TOOLKIT).map(([p, t]) => [t, p])) as Record<string, Platform>;
const MANAGED = new Set<Platform>(["facebook", "instagram", "linkedin", "pinterest", "youtube"]);
const envKey = (p: Platform) => `COMPOSIO_AUTH_CONFIG_${p === "x" ? "TWITTER" : p.toUpperCase()}`;

export const entityId = (clientId: string) => `client:${clientId}`;
export class SetupNeeded extends Error {}

/** True when Connect can work for this platform (managed auth, or an auth config is set). */
export function composioReady(p: Platform): boolean {
  return MANAGED.has(p) || Boolean(process.env[envKey(p)]?.trim());
}

/**
 * Readiness per platform, also counting auth configs created in the Composio dashboard (e.g. the agency's own
 * Threads, X or TikTok app), so adding one there switches its Connect button on without a redeploy.
 */
export async function composioReadyMap(): Promise<Record<Platform, boolean>> {
  const out = Object.fromEntries(PLATFORMS.map((p) => [p, composioReady(p)])) as Record<Platform, boolean>;
  if (PLATFORMS.every((p) => out[p])) return out;
  try {
    const list = await composio().authConfigs.list({ limit: 100 });
    for (const a of list.items) {
      const p = PLATFORMS.find((x) => TOOLKIT[x] === a.toolkit?.slug);
      if (p && a.status === "ENABLED") out[p] = true;
    }
  } catch { /* Composio unreachable: env/managed answer stands */ }
  return out;
}
export const setupNote = (p: Platform) =>
  `${PLATFORM_INFO[p].label} has no Composio-managed login. Create a ${PLATFORM_INFO[p].label} developer app and add it as an auth config for the "${TOOLKIT[p]}" toolkit in the Composio dashboard; the Connect button appears here automatically.`;

/** The auth config for a platform: env override, else an existing enabled one, else a new Composio-managed one. */
async function authConfigFor(p: Platform): Promise<string> {
  const fromEnv = process.env[envKey(p)]?.trim();
  if (fromEnv) return fromEnv;
  const list = await composio().authConfigs.list({ toolkit: TOOLKIT[p], limit: 20 });
  const found = list.items.find((a) => a.status === "ENABLED" && (a.toolkit?.slug ?? TOOLKIT[p]) === TOOLKIT[p]);
  if (found) return found.id;
  if (!MANAGED.has(p)) throw new SetupNeeded(setupNote(p));
  // read-only: only the scopes listed in the platform registry (src/config/platforms.ts), never Composio's broader defaults
  const scopes = platformBySocial(p)?.scopes.map((x) => x.scope) ?? [];
  const created = await composio().authConfigs.create(TOOLKIT[p], { type: "use_composio_managed_auth", name: `${TOOLKIT[p]}-social-analytics-readonly`, ...(scopes.length ? { credentials: { scopes } } : {}) });
  return created.id;
}

/** Starts the platform's login; returns the URL to send the browser to. */
export async function startSocialConnect(clientId: string, p: Platform, callbackUrl: string): Promise<string> {
  const req = await composio().connectedAccounts.link(entityId(clientId), await authConfigFor(p), { callbackUrl });
  if (!req.redirectUrl) throw new Error("Composio didn't return a login link.");
  return req.redirectUrl;
}

export interface SocialConnection { platform: Platform; id: string; status: string; createdAt: string }

/** The client's Composio social accounts (newest per platform; ACTIVE preferred). */
export async function socialConnections(clientId: string): Promise<SocialConnection[]> {
  const res = await composio().connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: Object.values(TOOLKIT), limit: 100 });
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
    try { await composio().connectedAccounts.waitForConnection(c.id, 20_000); } catch { /* checked below */ }
    c = (await socialConnections(clientId)).find((x) => x.platform === p) ?? null;
  }
  return c;
}

/** Removes every Composio account of this platform for the client. */
export async function disconnectSocialAccount(clientId: string, p: Platform) {
  const res = await composio().connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: [TOOLKIT[p]], limit: 50 });
  await Promise.all(res.items.map((a) => composio().connectedAccounts.delete(a.id)));
}
