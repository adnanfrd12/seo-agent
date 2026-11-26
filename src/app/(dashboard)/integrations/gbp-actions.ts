"use server";

import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { checkApp } from "@/lib/google/oauth";
import { CLIENT_ID_RE, deleteApp, saveApp } from "@/lib/google/oauth-apps";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function owner() {
  const { user, client } = await getSession();
  if (!client || !["owner", "admin"].includes(client.role)) return null;
  return user;
}

const input = z.object({
  clientId: z.string().trim().regex(CLIENT_ID_RE),
  clientSecret: z.string().trim().min(20).max(200),
});

/**
 * Saves the signed-in user's own Google OAuth app (client ID + secret, the secret encrypted). It is then used for
 * every Business Profile connection this user makes, and for clients they own. Checked with Google first.
 */
export async function saveGoogleApp(clientId: string, clientSecret: string): Promise<Result> {
  const user = await owner();
  if (!user) return { ok: false, error: "Only owners and admins can manage Google credentials." };
  const parsed = input.safeParse({ clientId, clientSecret });
  if (!parsed.success) {
    return { ok: false, error: "Enter the OAuth client ID (…apps.googleusercontent.com) and its client secret from Google Cloud → APIs & Services → Credentials." };
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY) return { ok: false, error: "TOKEN_ENCRYPTION_KEY isn't configured, so secrets can't be stored." };
  const check = await checkApp(parsed.data);
  if (!check.ok) return { ok: false, error: check.reason };
  try {
    await saveApp(createAdminClient(), user.id, parsed.data.clientId, parsed.data.clientSecret);
  } catch {
    return { ok: false, error: "Couldn't save the credentials (is migration 20261128000033 applied?)." };
  }
  revalidatePath("/integrations");
  return { ok: true, message: "Saved. Connect Business Profile to use them; existing connections keep the app they were made with until reconnected." };
}

export async function removeGoogleApp(): Promise<Result> {
  const user = await owner();
  if (!user) return { ok: false, error: "Only owners and admins can manage Google credentials." };
  await deleteApp(createAdminClient(), user.id);
  revalidatePath("/integrations");
  return { ok: true, message: "Removed. Connections made with these credentials need to be reconnected." };
}
