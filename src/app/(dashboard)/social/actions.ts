"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { encryptSecret } from "@/lib/crypto";
import { BudgetError } from "@/lib/dataforseo/budget";
import { resolveTarget } from "@/lib/dataforseo/research";
import { clientSocial, discoverProfiles, refreshSocial } from "@/lib/social/fetch";
import { PLATFORMS, platformOf, type Platform, type SocialProfiles } from "@/lib/social/platforms";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function owner() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can change social settings." } as const;
  return { client } as const;
}

/** Saves profile URLs, the LinkedIn organization id and any new tokens (encrypted; an empty field keeps the stored one, "-" removes it). */
export async function saveSocialSettings(input: { profiles: Partial<Record<Platform, string>>; tokens: Partial<Record<Platform, string>>; linkedinOrgId?: string }): Promise<Result> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  const profiles: SocialProfiles = {};
  for (const p of PLATFORMS) {
    const v = input.profiles[p]?.trim();
    if (!v) continue;
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    if (platformOf(url) !== p) return { ok: false, error: `That doesn't look like a ${p} profile URL: ${v}` };
    profiles[p] = url;
  }
  const admin = createAdminClient();
  const { settings } = await clientSocial(admin, o.client.id);
  const tokens = { ...((settings.social_tokens ?? {}) as Record<string, string>) };
  try {
    for (const p of PLATFORMS) {
      const t = input.tokens[p]?.trim();
      if (!t) continue;
      if (t === "-") delete tokens[p]; else tokens[p] = encryptSecret(t);
    }
  } catch { return { ok: false, error: "Tokens can't be stored: TOKEN_ENCRYPTION_KEY isn't set." }; }
  const orgId = input.linkedinOrgId?.trim().replace(/\D/g, "") || null;
  const { error } = await admin.from("clients").update({ settings: { ...settings, social_profiles: profiles, social_tokens: tokens, linkedin_org_id: orgId } }).eq("id", o.client.id);
  if (error) return { ok: false, error: "Couldn't save the settings." };
  revalidatePath("/social");
  return { ok: true, message: "Saved. Refresh the stats to read them." };
}

/** Looks for profile links on the client's website (free) and adds the ones not set yet. */
export async function detectSocialProfiles(): Promise<Result> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  const admin = createAdminClient();
  const target = await resolveTarget(admin, o.client.id);
  if (!target) return { ok: false, error: "Set the client's website first." };
  const found = await discoverProfiles(target.domain);
  const { settings, profiles } = await clientSocial(admin, o.client.id);
  const added = (Object.keys(found) as Platform[]).filter((p) => !profiles[p]);
  if (!added.length) return { ok: true, message: Object.keys(found).length ? "Nothing new: the website's profile links are already saved." : `No profile links found on ${target.domain} (home, contact and about pages). Add them by hand.` };
  await admin.from("clients").update({ settings: { ...settings, social_profiles: { ...found, ...profiles } } }).eq("id", o.client.id);
  revalidatePath("/social");
  return { ok: true, message: `Found ${added.join(", ")} on ${target.domain}.` };
}

/** Reads every platform now (YouTube through DataForSEO costs about 7 cents at most; the others are free official APIs). */
export async function refreshSocialNow(): Promise<Result> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  try {
    const r = await refreshSocial({ admin: createAdminClient(), clientId: o.client.id, source: "manual" });
    revalidatePath("/social");
    const ok = r.rows.filter((x) => x.status === "ok").map((x) => x.platform);
    return { ok: true, message: `Updated ${ok.length ? ok.join(", ") : "no platform"}${r.cost ? ` ($${r.cost.toFixed(3)})` : ""}.${r.stoppedByBudget ? " Stopped at the daily API budget." : ""}` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError ? e.message : "The social stats couldn't be refreshed. Try again in a few minutes." };
  }
}

/** Composio login link for one platform. The callback reads the stats as soon as the login finishes. */
export async function socialConnectLink(p: Platform): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  if (!(PLATFORMS as readonly string[]).includes(p)) return { ok: false, error: "Unknown platform." };
  const { SetupNeeded, startSocialConnect } = await import("@/lib/social/composio");
  try {
    const { serverEnv } = await import("@/lib/env");
    const url = await startSocialConnect(o.client.id, p, `${serverEnv().NEXT_PUBLIC_APP_URL}/api/social/callback?platform=${p}`);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof SetupNeeded ? e.message : `Couldn't start the ${p} login: ${(e instanceof Error ? e.message : "unknown error").slice(0, 200)}` };
  }
}

/** Removes the client's Composio connection for one platform (stats already stored are kept). */
export async function disconnectSocial(p: Platform): Promise<Result> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  if (!(PLATFORMS as readonly string[]).includes(p)) return { ok: false, error: "Unknown platform." };
  const { disconnectSocialAccount } = await import("@/lib/social/composio");
  try { await disconnectSocialAccount(o.client.id, p); } catch { return { ok: false, error: "Couldn't disconnect. Try again." }; }
  revalidatePath("/social");
  return { ok: true, message: "Disconnected. The stats already read are kept." };
}
