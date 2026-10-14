import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface CurrentClient {
  id: string;
  name: string;
  timezone: string;
  defaultRangeDays: number;
  role: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/** The signed-in user (with profile) and their first client. Single-client for now; schema supports many. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("client_members")
      .select("role, clients(id, name, timezone, default_range_days)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
  ]);

  const c = Array.isArray(membership?.clients) ? membership?.clients[0] : membership?.clients;
  const client: CurrentClient | null =
    membership && c
      ? { id: c.id, name: c.name, timezone: c.timezone, defaultRangeDays: c.default_range_days, role: membership.role }
      : null;

  const me: CurrentUser = {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
  return { user: me, client };
});
