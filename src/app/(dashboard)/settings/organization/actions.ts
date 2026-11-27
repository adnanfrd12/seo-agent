"use server";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { CURRENCIES, LANGUAGES, WEEK_STARTS } from "@/components/org/labels";
import { ACTIVE_CLIENT_COOKIE, getSession } from "@/lib/analytics/client-context";
import { createOrgClient, RANGE_DAYS, setClientAccess, setClientArchived, updateOrgClient, validTimeZone } from "@/lib/org/clients";
import { audit } from "@/lib/org/credentials";
import { createInvitation, resendInvitation, revokeInvitation } from "@/lib/org/invitations";
import { changeMemberRole, CLIENT_ROLES, removeMember, setMemberClientAccess, setMemberStatus } from "@/lib/org/members";
import { can, ORG_ROLES, PermissionError, requireOrg } from "@/lib/org/permissions";
import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

/**
 * Settings → Organization. Every action validates its input, checks the session and the user's role in the
 * organization named by `orgId` on the server (requireOrg), and writes the change to the audit log (in the lib).
 */
export type OrgActionResult = { ok: true; message?: string; link?: string; emailed?: boolean; id?: string } | { ok: false; error: string };

const id = z.uuid();
/** JSON with sorted keys (jsonb returns object keys in its own order), so unchanged values compare equal. */
const stable = (v: unknown): string => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const bad = (e: z.ZodError): OrgActionResult => ({ ok: false, error: e.issues[0]?.message ?? "Check the details and try again." });

/** Runs an action; a permission problem or failure becomes a message (Next.js redirects still go through). */
async function run(fn: () => Promise<OrgActionResult>, path = "/"): Promise<OrgActionResult> {
  try {
    const r = await fn();
    if (r.ok) revalidatePath(path, "layout");
    return r;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof PermissionError) return { ok: false, error: e.message };
    console.error("organization settings action failed:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

/* ------------------------------------------------------------------ general */
const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`).default("");
const generalSchema = z.object({
  name: z.string().trim().min(1, "Enter the organization's name.").max(120, "Use at most 120 characters for the name."),
  description: text(2000),
  website: text(300).transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .refine((v) => { if (!v) return true; try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes("."); } catch { return false; } }, "Enter a website address like https://example.com."),
  email: z.union([z.literal(""), z.email("Enter a valid business email.").max(200)]).default(""),
  phone: text(60).refine((v) => !v || /^[+()\d\s.\-/x]{5,60}$/i.test(v), "Use digits, spaces and + ( ) - only for the phone number."),
  address: z.object({ line1: text(160), line2: text(160), city: text(120), region: text(120), postal_code: text(30), country: text(120) }),
  timezone: z.string().refine(validTimeZone, "Choose a time zone from the list."),
  language: z.enum(LANGUAGES.map(([code]) => code) as [string, ...string[]]),
  currency: z.enum(CURRENCIES),
});
export type GeneralInput = z.input<typeof generalSchema>;

export async function saveGeneral(orgId: string, input: GeneralInput): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success) return { ok: false, error: "Unknown organization." };
    const parsed = generalSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error);
    const ctx = await requireOrg(can.manageSettings, orgId, "Only owners and admins can change the organization's details.");
    const v = parsed.data;
    const address = Object.fromEntries(Object.entries(v.address).filter(([, x]) => x));
    const next = { name: v.name, description: v.description || null, website: v.website || null, email: v.email || null, phone: v.phone || null, address, timezone: v.timezone, language: v.language, currency: v.currency };
    const { data: cur } = await ctx.admin.from("organizations").select("name, description, website, email, phone, address, timezone, language, currency").eq("id", orgId).single();
    const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => stable(next[k]) !== stable((cur as Record<string, unknown> | null)?.[k]));
    if (!fields.length) return { ok: true, message: "Nothing changed." };
    const { error } = await ctx.admin.from("organizations").update(next).eq("id", orgId);
    if (error) return { ok: false, error: "Couldn't save the details. Try again." };
    await audit(ctx.admin, orgId, ctx.userId, "organization.update", null, { fields });
    return { ok: true, message: "Organization details saved." };
  });
}

/* ------------------------------------------------------------------ preferences */
const prefsSchema = z.object({
  defaultRangeDays: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])),
  weekStart: z.enum(WEEK_STARTS.map((w) => w.id) as [string, ...string[]]),
});

export async function savePreferences(orgId: string, input: z.input<typeof prefsSchema>): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success) return { ok: false, error: "Unknown organization." };
    const parsed = prefsSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error);
    const ctx = await requireOrg(can.manageSettings, orgId, "Only owners and admins can change preferences.");
    const { data: cur } = await ctx.admin.from("organizations").select("preferences").eq("id", orgId).single();
    const before = (cur?.preferences ?? {}) as Record<string, unknown>;
    const changes = { default_range_days: parsed.data.defaultRangeDays, week_start: parsed.data.weekStart };
    const fields = Object.keys(changes).filter((k) => before[k] !== changes[k as keyof typeof changes]);
    if (!fields.length) return { ok: true, message: "Nothing changed." };
    // other keys stay as they are (other features may keep their own preferences here)
    const { error } = await ctx.admin.from("organizations").update({ preferences: { ...before, ...changes } }).eq("id", orgId);
    if (error) return { ok: false, error: "Couldn't save the preferences. Try again." };
    await audit(ctx.admin, orgId, ctx.userId, "organization.preferences", null, { fields });
    return { ok: true, message: "Preferences saved." };
  });
}

/* ------------------------------------------------------------------ invitations */
const accessSchema = z.array(z.object({ clientId: z.uuid(), role: z.enum(CLIENT_ROLES) })).max(2000);
const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").max(200),
  role: z.enum(ORG_ROLES, { error: "Choose a role." }),
  clientAccess: accessSchema.default([]),
});

export async function inviteMember(orgId: string, input: z.input<typeof inviteSchema>): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success) return { ok: false, error: "Unknown organization." };
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error);
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can invite people.");
    return createInvitation(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, parsed.data);
  }, "/settings");
}

export async function resendInvite(orgId: string, invitationId: string): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success || !id.safeParse(invitationId).success) return { ok: false, error: "Unknown invitation." };
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can manage invitations.");
    return resendInvitation(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, invitationId);
  }, "/settings");
}

export async function revokeInvite(orgId: string, invitationId: string): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success || !id.safeParse(invitationId).success) return { ok: false, error: "Unknown invitation." };
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can manage invitations.");
    return revokeInvitation(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, invitationId);
  }, "/settings");
}

/* ------------------------------------------------------------------ members */
export async function changeRole(orgId: string, userId: string, role: string): Promise<OrgActionResult> {
  return run(async () => {
    const p = z.object({ orgId: id, userId: id, role: z.enum(ORG_ROLES) }).safeParse({ orgId, userId, role });
    if (!p.success) return { ok: false, error: "Invalid request." };
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can change roles.");
    return changeMemberRole(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, userId, p.data.role);
  });
}

export async function setStatus(orgId: string, userId: string, status: string): Promise<OrgActionResult> {
  return run(async () => {
    const p = z.object({ orgId: id, userId: id, status: z.enum(["active", "deactivated"]) }).safeParse({ orgId, userId, status });
    if (!p.success) return { ok: false, error: "Invalid request." };
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can change access.");
    return setMemberStatus(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, userId, p.data.status);
  });
}

export async function removeFromOrg(orgId: string, userId: string): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success || !id.safeParse(userId).success) return { ok: false, error: "Invalid request." };
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can remove members.");
    return removeMember(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, userId);
  });
}

export async function saveMemberAccess(orgId: string, userId: string, access: z.input<typeof accessSchema>): Promise<OrgActionResult> {
  return run(async () => {
    const p = z.object({ orgId: id, userId: id, access: accessSchema }).safeParse({ orgId, userId, access });
    if (!p.success) return { ok: false, error: "Invalid request." };
    const ctx = await requireOrg(can.manageMembers, orgId, "Only owners and admins can change client access.");
    return setMemberClientAccess(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, userId, p.data.access);
  });
}

/* ------------------------------------------------------------------ clients */
const clientSchema = z.object({
  name: z.string().trim().min(1, "Enter the client's name.").max(120, "Use at most 120 characters for the name."),
  timezone: z.string().refine(validTimeZone, "Choose a time zone from the list."),
  defaultRangeDays: z.coerce.number().pipe(z.union([z.literal(RANGE_DAYS[0]), z.literal(RANGE_DAYS[1]), z.literal(RANGE_DAYS[2])])),
});

export async function createOrgClientAction(orgId: string, input: z.input<typeof clientSchema>): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success) return { ok: false, error: "Unknown organization." };
    const parsed = clientSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error);
    const ctx = await requireOrg(can.manageClients, orgId, "Only owners and admins can create clients.");
    return createOrgClient(await createClient(), ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, parsed.data);
  });
}

export async function updateOrgClientAction(orgId: string, clientId: string, input: z.input<typeof clientSchema>): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success || !id.safeParse(clientId).success) return { ok: false, error: "Unknown client." };
    const parsed = clientSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error);
    const ctx = await requireOrg(can.manageClients, orgId, "Only owners and admins can change clients.");
    return updateOrgClient(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, clientId, parsed.data);
  });
}

export async function archiveOrgClient(orgId: string, clientId: string, archived: boolean): Promise<OrgActionResult> {
  return run(async () => {
    if (!id.safeParse(orgId).success || !id.safeParse(clientId).success) return { ok: false, error: "Unknown client." };
    const ctx = await requireOrg(can.manageClients, orgId, "Only owners and admins can archive clients.");
    return setClientArchived(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, clientId, archived === true);
  });
}

export async function saveClientAccess(orgId: string, clientId: string, access: { userId: string; role: string }[]): Promise<OrgActionResult> {
  return run(async () => {
    const p = z.object({ orgId: id, clientId: id, access: z.array(z.object({ userId: id, role: z.enum(CLIENT_ROLES) })).max(2000) }).safeParse({ orgId, clientId, access });
    if (!p.success) return { ok: false, error: "Invalid request." };
    const ctx = await requireOrg(can.manageClients, orgId, "Only owners and admins can change who can open a client.");
    return setClientAccess(ctx.admin, orgId, { userId: ctx.userId, role: ctx.role }, clientId, p.data.access);
  });
}

/* ------------------------------------------------------------------ switching organization */
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

/**
 * Makes another organization the active one by opening its first client the user can reach. An organization
 * without clients (yet) has nothing to open: `empty` tells the caller to go to its settings instead.
 */
export async function switchOrganization(orgId: string): Promise<{ ok: true; empty?: boolean } | { ok: false; error: string }> {
  if (!id.safeParse(orgId).success) return { ok: false, error: "Unknown organization." };
  const { organizations, clients } = await getSession();
  if (!organizations.some((o) => o.id === orgId)) return { ok: false, error: "You're not a member of that organization." };
  const first = clients.find((c) => c.organizationId === orgId);
  if (!first) return { ok: true, empty: true };
  (await cookies()).set(ACTIVE_CLIENT_COOKIE, first.id, cookieOpts);
  revalidatePath("/", "layout");
  return { ok: true };
}
