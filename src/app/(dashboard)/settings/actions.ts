"use server";

import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { audit } from "@/lib/org/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

async function requireAdmin() {
  const { user, client } = await getSession();
  if (!client) throw new Error("No client");
  if (!["owner", "admin"].includes(client.role)) return { user, client, allowed: false as const };
  return { user, client, allowed: true as const };
}

/* ------------------------------------------------------------------ profile */
const profileSchema = z.object({
  fullName: z.string().trim().max(120),
  // only accept our own public avatars bucket URLs (or clearing the photo)
  avatarUrl: z.string().max(1000).nullable().optional(),
});

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the name (max 120 characters).");
  const { user } = await getSession();
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/`;
  const { avatarUrl, fullName } = parsed.data;
  if (avatarUrl && !avatarUrl.startsWith(base)) return fail("Invalid photo URL.");

  const supabase = await createClient();
  const row: Record<string, unknown> = { user_id: user.id, full_name: fullName || null };
  if (avatarUrl !== undefined) row.avatar_url = avatarUrl;
  const { error } = await supabase.from("profiles").upsert(row, { onConflict: "user_id" });
  if (error) return fail("Could not save your profile.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

/* ------------------------------------------------------------------- client */
const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  timezone: z.string().refine((tz) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
  }, "Unknown time zone"),
  defaultRangeDays: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])),
});

export async function updateClientSettings(input: z.input<typeof clientSchema>): Promise<ActionResult> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const { user, client, allowed } = await requireAdmin();
  if (!allowed) return fail("Only owners and admins can change client settings.");
  const supabase = await createClient(); // RLS + column grants enforce this too
  const { error } = await supabase.from("clients").update({
    name: parsed.data.name, timezone: parsed.data.timezone, default_range_days: parsed.data.defaultRangeDays,
  }).eq("id", client.id);
  if (error) return fail("Could not save client settings.");
  const fields = [
    parsed.data.name !== client.name && "name", parsed.data.timezone !== client.timezone && "timezone",
    parsed.data.defaultRangeDays !== client.defaultRangeDays && "default_range_days",
  ].filter(Boolean);
  if (fields.length) await audit(createAdminClient(), client.organizationId, user.id, "client.update", parsed.data.name, { client_id: client.id, fields });
  revalidatePath("/", "layout");
  return { ok: true, message: "Client settings saved." };
}

/* --------------------------------------------------------------------- team */
// Who can open a client is managed per organization: Settings → Organization → Team members and Clients
// (src/app/(dashboard)/settings/organization/actions.ts), with invitations instead of temporary passwords.

/* ------------------------------------------------------------------ workspace deletion */
/**
 * Deletes this workspace (client) for good: every connection through the deletion service (Composio accounts,
 * Google grants, tokens and all data received), then the client row and members who belong to no other workspace.
 * Owners only, and the exact workspace name must be typed to confirm.
 */
export async function deleteWorkspace(confirmName: string): Promise<ActionResult> {
  const { user, client } = await getSession();
  if (!client) return fail("No client selected.");
  if (client.role !== "owner") return fail("Only an owner can delete the workspace.");
  if (confirmName.trim() !== client.name.trim()) return fail("Type the workspace name exactly to confirm.");
  const { deleteWorkspace: run } = await import("@/lib/compliance/deletion");
  try {
    await run(createAdminClient(), client.id, "dashboard");
    await audit(createAdminClient(), client.organizationId, user.id, "client.delete", client.name, { client_id: client.id });
  } catch (e) {
    return fail(`The workspace couldn't be deleted completely: ${(e instanceof Error ? e.message : "unknown error").slice(0, 200)}. Try again or email im@waheedzen.com.`);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Workspace and its data deleted." };
}
