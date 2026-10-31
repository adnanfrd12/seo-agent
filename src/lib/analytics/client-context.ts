import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { memo } from "@/lib/memo";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_CLIENT_COOKIE = "sa_client";

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

type ClientRow = { id: string; name: string; timezone: string; default_range_days: number };

/**
 * The signed-in user (with profile), every client they belong to, and the active client: the one
 * named by the sa_client cookie if the user is still a member of it, otherwise their first.
 * The cookie is only a preference; membership is always re-checked here (and by RLS).
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  // getClaims verifies the signed session token locally (the proxy already refreshed it), so no round trip to Supabase Auth
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };

  // memberships and profile change rarely: reused for a minute (RLS still checks every data read)
  const [{ memberships, profile }, cookieStore] = await Promise.all([
    memo(`session|${user.id}`, 60_000, async () => {
      const [m, p] = await Promise.all([
        supabase.from("client_members").select("role, created_at, clients(id, name, timezone, default_range_days)").eq("user_id", user.id).order("created_at"),
        supabase.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
      ]);
      if (m.error) throw m.error;
      return { memberships: m.data, profile: p.data };
    }),
    cookies(),
  ]);

  const clients: CurrentClient[] = (memberships ?? []).flatMap((m) => {
    const c = (Array.isArray(m.clients) ? m.clients[0] : m.clients) as ClientRow | null;
    return c ? [{ id: c.id, name: c.name, timezone: c.timezone, defaultRangeDays: c.default_range_days, role: m.role }] : [];
  });
  const wanted = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value;
  const client = clients.find((c) => c.id === wanted) ?? clients[0] ?? null;

  const me: CurrentUser = {
    id: user.id,
    email: user.email,
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
  return { user: me, client, clients };
});
