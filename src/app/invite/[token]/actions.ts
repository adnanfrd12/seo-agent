"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_CLIENT_COOKIE } from "@/lib/analytics/client-context";
import { emailConfigured } from "@/lib/notify";
import {
  acceptInvitation, appOrigin, emailInviteSignInLink, inviteThrottled, isInviteToken, maskEmail, noteInviteMiss, prepareInviteSignIn,
} from "@/lib/org/invitations";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The invitation page's actions. The page is public, so everything is decided on the server from the token's hash
 * (src/lib/org/invitations.ts), and holding the link never gives control of an account: accepting needs a session
 * for the invited address. The token is never logged.
 */
export type InviteActionResult = { ok: true; message?: string } | { ok: false; error: string; needsPassword?: boolean };

const password = z.string().min(8, "Use at least 8 characters for your password.").max(72, "Use at most 72 characters for your password.");
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };
const SEND_FAILED = "Couldn't send the link right now. Try again in a few minutes.";

async function visitor() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
/** Wrong or malformed tokens count against the visitor (per server instance); valid ones never do. */
async function gate(token: string): Promise<InviteActionResult | null> {
  const key = await visitor();
  if (inviteThrottled(key)) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  if (!isInviteToken(token)) { noteInviteMiss(key); return { ok: false, error: "This invitation link isn't valid. Check that you copied all of it." }; }
  return null;
}

/** Signed in with the invited, confirmed address: join (an account an invitation made also chooses its password). */
export async function acceptInvite(token: string, input: { password?: string; fullName?: string } = {}): Promise<InviteActionResult> {
  const blocked = await gate(token);
  if (blocked) return blocked;
  if (input.password !== undefined) {
    const p = password.safeParse(input.password);
    if (!p.success) return { ok: false, error: p.error.issues[0].message, needsPassword: true };
  }
  const fullName = z.string().trim().max(120).safeParse(input.fullName ?? "");
  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims?.sub) return { ok: false, error: "Sign in first, then open the invitation link again." };
  const r = await acceptInvitation(createAdminClient(), token, data.claims.sub, { password: input.password, fullName: fullName.success ? fullName.data : undefined });
  if (!r.ok) {
    if (/isn't valid/.test(r.error)) noteInviteMiss(await visitor());
    return r;
  }
  // open the organization the person just joined
  if (r.firstClientId) (await cookies()).set(ACTIVE_CLIENT_COOKIE, r.firstClientId, cookieOpts);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Signed out, no usable account yet: email a sign-in link to the invited address (and only there). With the
 * platform's email it's our own one-time link (src/app/auth/confirm); otherwise Supabase sends it and the sign-in
 * finishes in this browser (/auth/callback). The answer is the same whether or not the address had an account.
 */
export async function sendInviteSignInLink(token: string): Promise<InviteActionResult> {
  const blocked = await gate(token);
  if (blocked) return blocked;
  const admin = createAdminClient();
  const prep = await prepareInviteSignIn(admin, token);
  if (!prep.ok) {
    if (prep.unknown) noteInviteMiss(await visitor());
    return { ok: false, error: prep.error };
  }
  if (emailConfigured()) {
    if (!(await emailInviteSignInLink(admin, { email: prep.email, token, orgName: prep.orgName }))) return { ok: false, error: SEND_FAILED };
  } else {
    const { error } = await (await createClient()).auth.signInWithOtp({
      email: prep.email,
      options: { shouldCreateUser: false, emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(`/invite/${token}`)}` },
    });
    if (error) return { ok: false, error: SEND_FAILED };
  }
  return { ok: true, message: `We've emailed a sign-in link to ${maskEmail(prep.email)}. Open it in this browser to continue.` };
}

/** Signed in as someone else: sign out and come back to the same invitation. */
export async function signOutForInvite(token: string): Promise<void> {
  await (await createClient()).auth.signOut();
  redirect(isInviteToken(token) ? `/invite/${token}` : "/login");
}
