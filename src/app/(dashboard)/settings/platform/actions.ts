"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { audit } from "@/lib/org/credentials";
import { createInvitation, resendInvitation } from "@/lib/org/invitations";
import { normalizeEnabledPages } from "@/lib/org/pages";
import { isPlatformAdmin } from "@/lib/org/permissions";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Platform super-admins only (platform_admins): create organizations, invite their owners and choose which
 * dashboard pages each organization may use. Checked on the server for every call; organization roles don't count.
 */
export type PlatformResult = { ok: true; message?: string; link?: string; emailed?: boolean; id?: string } | { ok: false; error: string };

async function requirePlatformAdmin() {
  const { user } = await getSession();
  const admin = createAdminClient();
  if (!(await isPlatformAdmin(admin, user.id))) throw new Error("not a platform admin");
  return { admin, userId: user.id };
}

async function run(fn: () => Promise<PlatformResult>): Promise<PlatformResult> {
  try {
    const r = await fn();
    if (r.ok) revalidatePath("/settings/platform", "page");
    return r;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof Error && e.message === "not a platform admin") return { ok: false, error: "Only platform administrators can do that." };
    console.error("platform action failed:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter the organization's name.").max(120, "Use at most 120 characters for the name."),
  ownerEmail: z.email("Enter the first owner's email address.").max(200),
});

/** A new, empty organization (no clients, no credentials) and an owner invitation for its first owner. */
export async function createOrganization(input: z.input<typeof createSchema>): Promise<PlatformResult> {
  return run(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
    const { admin, userId } = await requirePlatformAdmin();
    const { data: org, error } = await admin.from("organizations").insert({ name: parsed.data.name }).select("id").single();
    if (error || !org) return { ok: false, error: "Couldn't create the organization. Try again." };
    await audit(admin, org.id, userId, "organization.create", parsed.data.name, { by: "platform" });
    const inv = await createInvitation(admin, org.id, { userId, role: null, platformAdmin: true }, { email: parsed.data.ownerEmail, role: "owner", clientAccess: [] });
    if (!inv.ok) return { ok: true, id: org.id, message: `${parsed.data.name} created, but the owner invitation failed: ${inv.error}` };
    return { ok: true, id: org.id, link: inv.link, emailed: inv.emailed, message: `${parsed.data.name} created. ${inv.message}` };
  });
}

export async function inviteOwner(orgId: string, email: string): Promise<PlatformResult> {
  return run(async () => {
    const p = z.object({ orgId: z.uuid(), email: z.email("Enter a valid email address.").max(200) }).safeParse({ orgId, email });
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the details." };
    const { admin, userId } = await requirePlatformAdmin();
    const { data: org } = await admin.from("organizations").select("id").eq("id", orgId).maybeSingle();
    if (!org) return { ok: false, error: "That organization doesn't exist." };
    return createInvitation(admin, orgId, { userId, role: null, platformAdmin: true }, { email: p.data.email, role: "owner", clientAccess: [] });
  });
}

export async function resendOwnerInvite(orgId: string, invitationId: string): Promise<PlatformResult> {
  return run(async () => {
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(invitationId).success) return { ok: false, error: "Unknown invitation." };
    const { admin, userId } = await requirePlatformAdmin();
    return resendInvitation(admin, orgId, { userId, role: null, platformAdmin: true }, invitationId);
  });
}

/** Which dashboard pages an organization may use: every page (null, including pages added later) or a chosen list. */
export async function saveEnabledPages(orgId: string, input: { all: boolean; pages: string[] }): Promise<PlatformResult> {
  return run(async () => {
    const p = z.object({ orgId: z.uuid(), all: z.boolean(), pages: z.array(z.string().max(200)).max(500) }).safeParse({ orgId, ...input });
    if (!p.success) return { ok: false, error: "Invalid request." };
    const { admin, userId } = await requirePlatformAdmin();
    const pages = p.data.all ? null : normalizeEnabledPages(p.data.pages);
    const { data: before } = await admin.from("organizations").select("enabled_pages").eq("id", orgId).maybeSingle();
    if (!before) return { ok: false, error: "That organization doesn't exist." };
    const prev = (before.enabled_pages as string[] | null) ?? null;
    if (JSON.stringify(prev) === JSON.stringify(pages)) return { ok: true, message: "Nothing changed." };
    const { error } = await admin.from("organizations").update({ enabled_pages: pages }).eq("id", orgId);
    if (error) return { ok: false, error: "Couldn't save page access. Try again." };
    const was = new Set(prev ?? []), now = new Set(pages ?? []);
    await audit(admin, orgId, userId, "organization.pages", null, pages === null
      ? { all: true }
      : { all: false, enabled: pages.length, turned_on: prev ? pages.filter((x) => !was.has(x)) : [], turned_off: prev ? prev.filter((x) => !now.has(x)) : [] });
    return { ok: true, message: pages === null ? "Every page is enabled." : `${pages.length} pages enabled.` };
  });
}
