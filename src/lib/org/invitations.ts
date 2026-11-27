import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { CLIENT_ROLE_LABEL, ROLE_LABEL } from "@/components/org/labels";
import { SITE } from "@/config/platforms";
import { emailConfigured } from "@/lib/notify";
import { audit } from "./credentials";
import { allowedClientRole, orgClientIds, reachesAllClients, userDirectory, type ClientRole, type Result } from "./members";
import type { OrgRole } from "./permissions";

/**
 * Organization invitations.
 *  - The link carries a random 256-bit token; only its SHA-256 is stored, invitations are looked up by that hash
 *    alone and the token is never logged or written anywhere else. A link expires after 7 days and works once.
 *  - The link never controls an account: whoever holds it (the inviter has a copy) can only see the invitation.
 *    Accepting needs a session for the invited address, so the invitee proves the mailbox is theirs: an existing
 *    account signs in; otherwise the invitation page emails a sign-in link to the invited address only (Supabase
 *    confirms the address when it's opened) and the new account then chooses its password.
 *  - Delivery of the invitation itself: the platform's email (Resend) when it's configured, otherwise the inviter
 *    copies the link. The app is invite-only (no sign-up page): an address without an account gets an unconfirmed,
 *    password-less account made by that invitation (app_metadata.org_invites) through the Supabase admin API.
 *  - Accepting is claimed atomically (accepted_at is set only while the invitation is still open), then the role
 *    and client access are applied and the acceptance is audit-logged.
 */
export const INVITE_DAYS = 7;
const MAX_OPEN = 100;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newInviteToken = () => randomBytes(32).toString("base64url");
export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isInviteToken = (token: string) => TOKEN.test(token);
export const appOrigin = () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || SITE.appUrl).replace(/\/+$/, "");
export const inviteLink = (token: string) => `${appOrigin()}/invite/${token}`;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export interface Inviter { userId: string; role: OrgRole | null; platformAdmin?: boolean }
export interface AccessGrant { clientId: string; role: ClientRole }
export type InviteResult = { ok: true; message: string; link: string; emailed: boolean } | { ok: false; error: string };

type Row = {
  id: string; organization_id: string; email: string; role: OrgRole; client_access: { client_id: string; role: ClientRole }[];
  invited_by: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string;
};
const COLS = "id, organization_id, email, role, client_access, invited_by, expires_at, accepted_at, revoked_at, created_at";

export interface OpenInvitation {
  id: string; email: string; role: OrgRole; clientAccess: AccessGrant[]; invitedBy: string | null;
  createdAt: string; expiresAt: string; expired: boolean;
}

/** May this inviter invite (or resend / withdraw an invitation for) this role? */
function mayInvite(inviter: Inviter, role: OrgRole): string | null {
  if (inviter.platformAdmin) return null;
  if (inviter.role !== "owner" && inviter.role !== "admin") return "Only owners and admins can invite people.";
  if (role === "owner" && inviter.role !== "owner") return "Only an owner can invite another owner.";
  return null;
}

async function userIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await admin.rpc("find_user_id_by_email", { p_email: email });
  return (data as string | null) ?? null;
}

const inviteIds = (u: User | null | undefined): string[] => {
  const v = (u?.app_metadata as { org_invites?: unknown } | undefined)?.org_invites;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
/** An account an invitation made that hasn't chosen a password yet (it does so once signed in, on the invitation page). */
export const awaitingPassword = (u: User | null | undefined) => inviteIds(u).length > 0;
/** jo•••@example.com: enough to recognise the address on a page anyone holding the link can open. */
export function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, local.length > 3 ? 2 : 1)}•••@${domain}`;
}

export async function listInvitations(admin: SupabaseClient, orgId: string): Promise<OpenInvitation[]> {
  const { data, error } = await admin.from("organization_invitations").select(COLS).eq("organization_id", orgId)
    .is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }).limit(MAX_OPEN);
  if (error) throw new Error("Couldn't read the invitations.");
  const now = Date.now();
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, email: r.email, role: r.role, clientAccess: (r.client_access ?? []).map((a) => ({ clientId: a.client_id, role: a.role })),
    invitedBy: r.invited_by, createdAt: r.created_at, expiresAt: r.expires_at, expired: Date.parse(r.expires_at) <= now,
  }));
}

/* ------------------------------------------------------------------ delivery */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM!.trim(), to: [to], subject: subject.replace(/\s+/g, " ").slice(0, 200), html, text }),
    });
    return res.ok;
  } catch { return false; }
}

function sendInviteEmail(to: string, p: { orgName: string; inviterName: string | null; role: OrgRole; link: string; expiresAt: string }): Promise<boolean> {
  const who = p.inviterName ? esc(p.inviterName) : "Someone";
  const until = new Date(p.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return sendEmail(to, `${p.inviterName ? `${p.inviterName} invited you` : "You're invited"} to join ${p.orgName} on SEO Insights`,
    `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#17171a"><h2 style="margin:0 0 12px">Join ${esc(p.orgName)} on SEO Insights</h2>`
    + `<p>${who} invited you to join <strong>${esc(p.orgName)}</strong> as ${esc(ROLE_LABEL[p.role])}.</p>`
    + `<p style="margin:24px 0"><a href="${esc(p.link)}" style="background:#e0482e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Accept the invitation</a></p>`
    + `<p style="color:#5d5d66;font-size:14px">The link works once and expires on ${until}. If you weren't expecting this invitation, you can ignore this email.</p></div>`,
    `${p.inviterName ?? "Someone"} invited you to join ${p.orgName} on SEO Insights as ${ROLE_LABEL[p.role]}.\n\nAccept: ${p.link}\n\nThe link works once and expires on ${until}.`);
}

/**
 * An address without an account gets one now (unconfirmed, no password, made by this invitation); an existing
 * account is never touched. Then the invitation is emailed when the platform can. Returns whether it was emailed.
 */
async function prepareAndDeliver(admin: SupabaseClient, inv: { id: string; email: string; role: OrgRole; orgName: string; inviterName: string | null; token: string; expiresAt: string }): Promise<boolean> {
  await ensureAccount(admin, inv.email, inv.id);
  return sendInviteEmail(inv.email, { orgName: inv.orgName, inviterName: inv.inviterName, role: inv.role, link: inviteLink(inv.token), expiresAt: inv.expiresAt });
}

async function ensureAccount(admin: SupabaseClient, email: string, invitationId: string): Promise<boolean> {
  if (await userIdByEmail(admin, email)) return true;
  // never confirmed here: Supabase confirms the address when the invitee opens the sign-in link sent to it
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: false, app_metadata: { org_invites: [invitationId] } });
  return !error || Boolean(await userIdByEmail(admin, email));
}

async function context(admin: SupabaseClient, orgId: string, inviterId: string) {
  const [{ data: org }, people] = await Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    userDirectory(admin, [inviterId]),
  ]);
  const me = people.get(inviterId);
  return { orgName: (org?.name as string | undefined) ?? "an organization", inviterName: me?.fullName || me?.email || null };
}

const deliveredMessage = (email: string, emailed: boolean) => emailed
  ? `Invitation sent to ${email}. You can also copy the link below.`
  : `Invitation ready for ${email}. Copy the link below and send it to them.`;

/* ------------------------------------------------------------------ invite, resend, withdraw */
export async function createInvitation(admin: SupabaseClient, orgId: string, inviter: Inviter, input: { email: string; role: OrgRole; clientAccess: AccessGrant[] }): Promise<InviteResult> {
  const email = normalizeEmail(input.email);
  const denied = mayInvite(inviter, input.role);
  if (denied) return { ok: false, error: denied };

  // client access only for team members and viewers (owners and admins reach every client)
  let access: { client_id: string; role: ClientRole }[] = [];
  if (!reachesAllClients(input.role)) {
    const inOrg = await orgClientIds(admin, orgId);
    if (input.clientAccess.some((a) => !inOrg.has(a.clientId))) return { ok: false, error: "Some of those clients aren't in this organization." };
    const actorRole: OrgRole = inviter.platformAdmin ? "owner" : inviter.role!;
    access = [...new Map(input.clientAccess.map((a) => [a.clientId, allowedClientRole(a.role, input.role, actorRole)]))].map(([client_id, role]) => ({ client_id, role }));
  }

  const existingId = await userIdByEmail(admin, email);
  if (existingId) {
    const { data: m } = await admin.from("organization_members").select("status").eq("organization_id", orgId).eq("user_id", existingId).maybeSingle();
    if (m?.status === "active") return { ok: false, error: `${email} is already a member. Change their role or client access in the list.` };
  }

  const { data: open } = await admin.from("organization_invitations").select("id, expires_at").eq("organization_id", orgId).eq("email", email)
    .is("accepted_at", null).is("revoked_at", null).maybeSingle();
  if (!open) {
    const { count } = await admin.from("organization_invitations").select("id", { count: "exact", head: true }).eq("organization_id", orgId)
      .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString());
    if ((count ?? 0) >= MAX_OPEN) return { ok: false, error: `This organization has ${MAX_OPEN} open invitations. Withdraw some first.` };
  }

  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const fields = { role: input.role, client_access: access, token_hash: hashInviteToken(token), invited_by: inviter.userId, expires_at: expiresAt };
  // inviting the same address again refreshes its open invitation (the old link stops working)
  const { data: saved, error } = open
    ? await admin.from("organization_invitations").update({ ...fields, created_at: new Date().toISOString() }).eq("id", open.id).select("id").single()
    : await admin.from("organization_invitations").insert({ organization_id: orgId, email, ...fields }).select("id").single();
  if (error || !saved) return { ok: false, error: "Couldn't create the invitation. Try again." };

  const ctx = await context(admin, orgId, inviter.userId);
  const emailed = await prepareAndDeliver(admin, { id: saved.id as string, email, role: input.role, token, expiresAt, ...ctx });
  await audit(admin, orgId, inviter.userId, "member.invite", email, { role: input.role, clients: access.length, emailed, ...(inviter.platformAdmin && !inviter.role ? { by: "platform" } : {}) });
  return { ok: true, link: inviteLink(token), emailed, message: deliveredMessage(email, emailed) };
}

async function openInvitation(admin: SupabaseClient, orgId: string, id: string): Promise<Row | null> {
  const { data } = await admin.from("organization_invitations").select(COLS).eq("id", id).eq("organization_id", orgId)
    .is("accepted_at", null).is("revoked_at", null).maybeSingle();
  return (data as Row | null) ?? null;
}

/** A new link (the previous one stops working) valid for another 7 days, delivered again. */
export async function resendInvitation(admin: SupabaseClient, orgId: string, inviter: Inviter, id: string): Promise<InviteResult> {
  const inv = await openInvitation(admin, orgId, id);
  if (!inv) return { ok: false, error: "That invitation was already accepted or withdrawn." };
  const denied = mayInvite(inviter, inv.role);
  if (denied) return { ok: false, error: denied };
  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const { error } = await admin.from("organization_invitations").update({ token_hash: hashInviteToken(token), expires_at: expiresAt })
    .eq("id", id).eq("organization_id", orgId).is("accepted_at", null).is("revoked_at", null);
  if (error) return { ok: false, error: "Couldn't renew the invitation. Try again." };
  const ctx = await context(admin, orgId, inviter.userId);
  const emailed = await prepareAndDeliver(admin, { id, email: inv.email, role: inv.role, token, expiresAt, ...ctx });
  await audit(admin, orgId, inviter.userId, "invitation.resend", inv.email, { role: inv.role, emailed });
  return { ok: true, link: inviteLink(token), emailed, message: deliveredMessage(inv.email, emailed) };
}

export async function revokeInvitation(admin: SupabaseClient, orgId: string, inviter: Inviter, id: string): Promise<Result> {
  const inv = await openInvitation(admin, orgId, id);
  if (!inv) return { ok: false, error: "That invitation was already accepted or withdrawn." };
  const denied = mayInvite(inviter, inv.role);
  if (denied) return { ok: false, error: denied };
  const { error } = await admin.from("organization_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", orgId).is("accepted_at", null).is("revoked_at", null);
  if (error) return { ok: false, error: "Couldn't withdraw the invitation. Try again." };
  await audit(admin, orgId, inviter.userId, "invitation.revoke", inv.email, { role: inv.role });
  return { ok: true, message: "Invitation withdrawn: the link no longer works." };
}

/* ------------------------------------------------------------------ the invitation page */
export type InvitationState = "valid" | "expired" | "revoked" | "accepted";
export interface InvitationView {
  id: string; orgId: string; orgName: string; email: string; role: OrgRole; roleLabel: string;
  clients: { name: string; role: string }[]; inviterName: string | null; expiresAt: string; state: InvitationState;
}

async function rowByToken(admin: SupabaseClient, token: string): Promise<Row | null> {
  if (!isInviteToken(token)) return null;
  const { data } = await admin.from("organization_invitations").select(COLS).eq("token_hash", hashInviteToken(token)).maybeSingle();
  return (data as Row | null) ?? null;
}
const stateOf = (r: Row): InvitationState => r.accepted_at ? "accepted" : r.revoked_at ? "revoked" : Date.parse(r.expires_at) <= Date.now() ? "expired" : "valid";

/** What the invitation page shows, found by the token's hash only (null for an unknown or malformed token). */
export async function findInvitation(admin: SupabaseClient, token: string): Promise<InvitationView | null> {
  const r = await rowByToken(admin, token);
  if (!r) return null;
  const ids = (r.client_access ?? []).map((a) => a.client_id);
  const [{ data: org }, people, { data: cl }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", r.organization_id).maybeSingle(),
    userDirectory(admin, [r.invited_by]),
    ids.length ? admin.from("clients").select("id, name").eq("organization_id", r.organization_id).in("id", ids.slice(0, 100)) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = new Map((cl ?? []).map((c) => [c.id as string, c.name as string]));
  const inviter = r.invited_by ? people.get(r.invited_by) : undefined;
  return {
    id: r.id, orgId: r.organization_id, orgName: (org?.name as string | undefined) ?? "an organization", email: r.email, role: r.role, roleLabel: ROLE_LABEL[r.role],
    clients: (r.client_access ?? []).flatMap((a) => names.has(a.client_id) ? [{ name: names.get(a.client_id)!, role: CLIENT_ROLE_LABEL[a.role] }] : []),
    inviterName: inviter?.fullName || inviter?.email || null, expiresAt: r.expires_at, state: stateOf(r),
  };
}

/**
 * For a signed-out visitor: "sign_in" for an account that can sign in (confirmed, with its own password),
 * "email_link" when there's no usable account yet (none, one an invitation made that hasn't chosen a password, or one
 * whose address was never confirmed): the invitation page then offers to email a sign-in link to the invited address.
 */
export async function accountStep(admin: SupabaseClient, inv: { email: string }): Promise<"email_link" | "sign_in"> {
  const id = await userIdByEmail(admin, inv.email);
  if (!id) return "email_link";
  const { data } = await admin.auth.admin.getUserById(id);
  return awaitingPassword(data?.user) || !data?.user?.email_confirmed_at ? "email_link" : "sign_in";
}

const STATE_ERROR: Record<Exclude<InvitationState, "valid">, string> = {
  expired: "This invitation has expired. Ask for a new one.",
  revoked: "This invitation was withdrawn.",
  accepted: "This invitation was already accepted.",
};
const NOT_FOUND = "This invitation link isn't valid. Check that you copied all of it.";
const SEND_FAILED = "Couldn't send the link right now. Try again in a few minutes.";

/* sign-in links per invitation (per server instance): a few within 15 minutes */
const linkSends = new Map<string, number[]>();
const LINK_WINDOW = 15 * 60_000, LINK_LIMIT = 3;

/**
 * Before the invitation page emails a sign-in link: the invitation must be open, a few links per 15 minutes at
 * most, and an address without an account gets one (unconfirmed, no password). Returns the address to send to.
 * Never says whether the address already had an account.
 */
export async function prepareInviteSignIn(admin: SupabaseClient, token: string): Promise<{ ok: true; email: string; orgName: string } | { ok: false; error: string; unknown?: boolean }> {
  const r = await rowByToken(admin, token);
  if (!r) return { ok: false, error: NOT_FOUND, unknown: true };
  const state = stateOf(r);
  if (state !== "valid") return { ok: false, error: STATE_ERROR[state] };
  const now = Date.now();
  const recent = (linkSends.get(r.id) ?? []).filter((t) => now - t < LINK_WINDOW);
  if (recent.length >= LINK_LIMIT) return { ok: false, error: "We've sent a few links already. Check your inbox and spam folder, or try again in 15 minutes." };
  linkSends.set(r.id, [...recent, now]);
  if (linkSends.size > 5000) linkSends.clear();
  if (!(await ensureAccount(admin, r.email, r.id))) return { ok: false, error: SEND_FAILED };
  const { data: org } = await admin.from("organizations").select("name").eq("id", r.organization_id).maybeSingle();
  return { ok: true, email: r.email, orgName: (org?.name as string | undefined) ?? "SEO Insights" };
}

/**
 * Platform email (Resend) only: a one-time sign-in link for the invited address, emailed to that address and to
 * nobody else (it's never returned to the browser that asked, nor shown to the inviter). Opening it signs the person
 * in (src/app/auth/confirm) and brings them back to the invitation.
 */
export async function emailInviteSignInLink(admin: SupabaseClient, p: { email: string; token: string; orgName: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: p.email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) return false;
  const vt = data.properties.verification_type;
  const type = ["magiclink", "email", "signup", "invite"].includes(vt) ? vt : "magiclink";
  const link = `${appOrigin()}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=${type}&next=${encodeURIComponent(`/invite/${p.token}`)}`;
  return sendEmail(p.email, `Your sign-in link for ${p.orgName}`,
    `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#17171a"><h2 style="margin:0 0 12px">Confirm it's you</h2>`
    + `<p>Open this link to sign in to SEO Insights and accept your invitation to <strong>${esc(p.orgName)}</strong>.</p>`
    + `<p style="margin:24px 0"><a href="${esc(link)}" style="background:#e0482e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Sign in and continue</a></p>`
    + `<p style="color:#5d5d66;font-size:14px">The link works once and expires soon. If you didn't ask for it, you can ignore this email.</p></div>`,
    `Open this link to sign in to SEO Insights and accept your invitation to ${p.orgName}:\n\n${link}\n\nThe link works once and expires soon. If you didn't ask for it, ignore this email.`);
}

/**
 * Accepts the invitation for the signed-in user, whose (confirmed) email must be the invited one. An account an
 * invitation made chooses its password (and name) here. The invitation is claimed atomically, so a link works once.
 */
export async function acceptInvitation(admin: SupabaseClient, token: string, who: string | { id: string; email?: string }, opts: { password?: string; fullName?: string } = {}): Promise<{ ok: true; orgId: string; role: OrgRole; firstClientId: string | null } | { ok: false; error: string; needsPassword?: boolean }> {
  // the user id (an object with an id is accepted too); the email is always read from the account itself
  const userId = typeof who === "string" ? who : who.id;
  const r = await rowByToken(admin, token);
  if (!r) return { ok: false, error: NOT_FOUND };
  const state = stateOf(r);
  if (state !== "valid") return { ok: false, error: STATE_ERROR[state] };
  // the account's current email (not the session token's copy)
  const { data: u } = await admin.auth.admin.getUserById(userId);
  if (!u?.user || normalizeEmail(u.user.email ?? "") !== normalizeEmail(r.email)) return { ok: false, error: "This invitation is for a different email address. Sign out, then open the link again." };
  // the mailbox is proven: Supabase confirmed the address when a link sent to it was opened
  if (!u.user.email_confirmed_at) return { ok: false, error: "Confirm your email address first: open the sign-in link we emailed you." };
  const user = { id: userId };

  // an account an invitation made has no password yet: it chooses one now (signed in through the emailed link)
  if (awaitingPassword(u.user)) {
    if (!opts.password) return { ok: false, error: "Choose a password for your account.", needsPassword: true };
    const name = opts.fullName?.trim().slice(0, 120);
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: opts.password, app_metadata: { org_invites: null }, ...(name ? { user_metadata: { full_name: name } } : {}) });
    if (error) return { ok: false, error: /password/i.test(error.message) ? error.message : "Couldn't set your password. Try again.", needsPassword: true };
    if (name) await admin.from("profiles").upsert({ user_id: user.id, full_name: name }, { onConflict: "user_id" });
  }

  // claim: only while still open, so two clicks can't both succeed
  const { data: claimed } = await admin.from("organization_invitations").update({ accepted_at: new Date().toISOString() })
    .eq("id", r.id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (!claimed) return { ok: false, error: "This invitation was already used, withdrawn or has expired." };

  const unclaim = async (error: string) => {
    await admin.from("organization_invitations").update({ accepted_at: null }).eq("id", r.id);
    return { ok: false as const, error };
  };
  const { data: m } = await admin.from("organization_members").select("role, status").eq("organization_id", r.organization_id).eq("user_id", user.id).maybeSingle();
  let role = r.role;
  if (!m) {
    const { error } = await admin.from("organization_members").insert({ organization_id: r.organization_id, user_id: user.id, role: r.role });
    if (error) return unclaim("Couldn't add you to the organization. Try again.");
  } else if (m.status !== "active") {
    const { error } = await admin.from("organization_members").update({ role: r.role, status: "active" }).eq("organization_id", r.organization_id).eq("user_id", user.id);
    if (error) return unclaim("Couldn't add you to the organization. Try again.");
  } else role = m.role as OrgRole; // already an active member: their role stays

  let granted = 0;
  if (!reachesAllClients(role) && r.client_access?.length) {
    const inOrg = await orgClientIds(admin, r.organization_id);
    const rows = r.client_access.filter((a) => inOrg.has(a.client_id))
      .map((a) => ({ client_id: a.client_id, user_id: user.id, role: role === "viewer" ? "viewer" : a.role }));
    if (rows.length) {
      // existing access is kept as it is
      const { error } = await admin.from("client_members").upsert(rows, { onConflict: "client_id,user_id", ignoreDuplicates: true });
      if (!error) granted = rows.length;
    }
  }
  await audit(admin, r.organization_id, user.id, "invitation.accept", r.email, { role, clients: granted });

  // the client to open first: any client for owners and admins, otherwise one they were given
  let firstClientId: string | null = null;
  if (reachesAllClients(role)) {
    const { data } = await admin.from("clients").select("id").eq("organization_id", r.organization_id).is("archived_at", null).order("created_at").limit(1).maybeSingle();
    firstClientId = (data?.id as string | undefined) ?? null;
  } else {
    const { data } = await admin.from("client_members").select("client_id, clients!inner(organization_id, archived_at, created_at)")
      .eq("user_id", user.id).eq("clients.organization_id", r.organization_id).is("clients.archived_at", null).limit(1).maybeSingle();
    firstClientId = (data?.client_id as string | undefined) ?? null;
  }
  return { ok: true, orgId: r.organization_id, role, firstClientId };
}

/* ------------------------------------------------------------------ wrong-token throttle (per server instance) */
const misses = new Map<string, { n: number; at: number }>();
const WINDOW = 10 * 60_000, LIMIT = 30;
export function inviteThrottled(key: string): boolean {
  const m = misses.get(key);
  return Boolean(m && Date.now() - m.at < WINDOW && m.n >= LIMIT);
}
export function noteInviteMiss(key: string) {
  const m = misses.get(key);
  if (!m || Date.now() - m.at >= WINDOW) misses.set(key, { n: 1, at: Date.now() }); else m.n++;
  if (misses.size > 5000) misses.clear();
}
