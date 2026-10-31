"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { ACTIVE_CLIENT_COOKIE, getSession } from "@/lib/analytics/client-context";
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

/** Create a client (the caller becomes its owner) and switch to it. */
export async function createAndSwitchClient(name: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = z.string().trim().min(1, "Enter a client name").max(120).safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_client", { p_name: parsed.data });
  if (error || !data) return { ok: false, error: "Could not create the client." };
  (await cookies()).set(ACTIVE_CLIENT_COOKIE, String(data), cookieOpts);
  revalidatePath("/", "layout");
  return { ok: true };
}
