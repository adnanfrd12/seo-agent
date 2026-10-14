"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });
const ROLES = ["owner", "admin", "viewer"] as const;

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
  const { client, allowed } = await requireAdmin();
  if (!allowed) return fail("Only owners and admins can change client settings.");
  const supabase = await createClient(); // RLS + column grants enforce this too
  const { error } = await supabase.from("clients").update({
    name: parsed.data.name, timezone: parsed.data.timezone, default_range_days: parsed.data.defaultRangeDays,
  }).eq("id", client.id);
  if (error) return fail("Could not save client settings.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Client settings saved." };
}

/* --------------------------------------------------------------------- team */
const addSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.trim().toLowerCase()),
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(ROLES),
  // only needed when the person doesn't have an account yet
  password: z.string().max(72).optional(),
});

export async function addTeamMember(input: z.input<typeof addSchema>): Promise<ActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid details.");
  const { client, allowed } = await requireAdmin();
  if (!allowed) return fail("Only owners and admins can add users.");
  if (parsed.data.role === "owner" && client.role !== "owner") return fail("Only an owner can add another owner.");

  const admin = createAdminClient();
  const { email, fullName, role, password } = parsed.data;

  const { data: existingId } = await admin.rpc("find_user_id_by_email", { p_email: email });
  let userId = existingId as string | null;
  let created = false;

  if (!userId) {
    if (!password || password.length < 8) {
      return fail("This person has no account yet: set a temporary password of at least 8 characters.");
    }
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    if (error || !data.user) return fail(error?.message ?? "Could not create the account.");
    userId = data.user.id;
    created = true;
    if (fullName) await admin.from("profiles").upsert({ user_id: userId, full_name: fullName }, { onConflict: "user_id" });
  }

  const { error: memberErr } = await admin
    .from("client_members")
    .insert({ client_id: client.id, user_id: userId, role });
  if (memberErr) {
    return fail(memberErr.code === "23505" ? "This person is already on the team." : "Could not add the user to this client.");
  }
  revalidatePath("/settings");
  return {
    ok: true,
    message: created
      ? `Account created for ${email}. Share the temporary password with them securely; they can change it in Settings.`
      : `${email} already had an account and now has access.`,
  };
}

async function ownerCount(clientId: string) {
  const admin = createAdminClient();
  const { count } = await admin.from("client_members").select("user_id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("role", "owner");
  return count ?? 0;
}

export async function updateMemberRole(input: { userId: string; role: string }): Promise<ActionResult> {
  const parsed = z.object({ userId: z.uuid(), role: z.enum(ROLES) }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { user, client, allowed } = await requireAdmin();
  if (!allowed) return fail("Only owners and admins can change roles.");
  const admin = createAdminClient();
  const { data: target } = await admin.from("client_members").select("role")
    .eq("client_id", client.id).eq("user_id", parsed.data.userId).maybeSingle();
  if (!target) return fail("User not found on this team.");
  // owners are managed by owners only
  if ((target.role === "owner" || parsed.data.role === "owner") && client.role !== "owner") {
    return fail("Only an owner can grant or remove the owner role.");
  }
  if (target.role === "owner" && parsed.data.role !== "owner" && (await ownerCount(client.id)) <= 1) {
    return fail("A client needs at least one owner.");
  }
  if (parsed.data.userId === user.id && parsed.data.role === "viewer") {
    return fail("You can't demote yourself to viewer; ask another admin.");
  }
  const { error } = await admin.from("client_members").update({ role: parsed.data.role })
    .eq("client_id", client.id).eq("user_id", parsed.data.userId);
  if (error) return fail("Could not change the role.");
  revalidatePath("/settings");
  return { ok: true, message: "Role updated." };
}

export async function removeMember(input: { userId: string }): Promise<ActionResult> {
  const parsed = z.object({ userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { user, client, allowed } = await requireAdmin();
  if (!allowed) return fail("Only owners and admins can remove users.");
  if (parsed.data.userId === user.id) return fail("You can't remove yourself.");
  const admin = createAdminClient();
  const { data: target } = await admin.from("client_members").select("role")
    .eq("client_id", client.id).eq("user_id", parsed.data.userId).maybeSingle();
  if (!target) return fail("User not found on this team.");
  if (target.role === "owner" && client.role !== "owner") return fail("Only an owner can remove an owner.");
  if (target.role === "owner" && (await ownerCount(client.id)) <= 1) return fail("A client needs at least one owner.");
  // removes access to this client only; the person's account itself is kept
  const { error } = await admin.from("client_members").delete()
    .eq("client_id", client.id).eq("user_id", parsed.data.userId);
  if (error) return fail("Could not remove the user.");
  revalidatePath("/settings");
  return { ok: true, message: "Access removed." };
}
