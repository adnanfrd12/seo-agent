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

/** The signed-in user and their first client. Single-client for now; schema supports many. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("client_members")
    .select("role, clients(id, name, timezone, default_range_days)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const c = Array.isArray(membership?.clients) ? membership?.clients[0] : membership?.clients;
  const client: CurrentClient | null =
    membership && c
      ? { id: c.id, name: c.name, timezone: c.timezone, defaultRangeDays: c.default_range_days, role: membership.role }
      : null;

  return { user: { id: user.id, email: user.email ?? "" }, client };
});
