"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { ACTIVE_CLIENT_COOKIE, getSession } from "@/lib/analytics/client-context";
import { createOrgClient, orgClientDefaults } from "@/lib/org/clients";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

/** Switch the active client. Only clients the user belongs to are accepted. */
export async function setActiveClient(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const id = z.uuid().safeParse(clientId);
  if (!id.success) return { ok: false, error: "Invalid client." };
  const { clients } = await getSession();
  if (!clients.some((c) => c.id === id.data)) return { ok: false, error: "You don't have access to that client." };
  (await cookies()).set(ACTIVE_CLIENT_COOKIE, id.data, cookieOpts);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Create a client in the active organization (organization owners and admins; it starts with the organization's
 * time zone and default date range) and switch to it. Audit-logged like Settings → Organization → Clients.
 */
export async function createAndSwitchClient(name: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = z.string().trim().min(1, "Enter a client name").max(120).safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const { user, organization } = await getSession();
  if (!organization || (organization.role !== "owner" && organization.role !== "admin")) {
    return { ok: false, error: "Only organization owners and admins can create clients. Ask one of them to add it." };
  }
  const admin = createAdminClient();
  const r = await createOrgClient(await createClient(), admin, organization.id, { userId: user.id, role: organization.role },
    { name: parsed.data, ...(await orgClientDefaults(admin, organization.id)) });
  if (!r.ok) return { ok: false, error: r.error };
  (await cookies()).set(ACTIVE_CLIENT_COOKIE, r.id, cookieOpts);
  revalidatePath("/", "layout");
  return { ok: true };
}
