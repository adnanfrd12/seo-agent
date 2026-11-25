import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** GET: the user's conversations for the active client (newest first), or one conversation's messages with ?id=. DELETE ?id=: remove one. */
export async function GET(req: Request) {
  const { client, user } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const admin = createAdminClient();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid id." }, { status: 400 });
    const { data: conv } = await admin.from("nova_conversations").select("id, title").eq("id", id).eq("client_id", client.id).eq("user_id", user.id).maybeSingle();
    if (!conv) return Response.json({ error: "Not found." }, { status: 404 });
    const [{ data: messages }, { data: pending }] = await Promise.all([
      admin.from("nova_messages").select("id, role, content, actions, created_at").eq("conversation_id", id).order("created_at").limit(200),
      admin.from("nova_pending_actions").select("id, summary, input, tool, created_at").eq("conversation_id", id).eq("status", "pending").order("created_at"),
    ]);
    return Response.json({ conversation: conv, messages: messages ?? [], pending: pending ?? [] });
  }
  const { data, error } = await admin.from("nova_conversations").select("id, title, updated_at").eq("client_id", client.id).eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50);
  if (error) return Response.json({ conversations: [], setup: true });
  return Response.json({ conversations: data ?? [] });
}

export async function DELETE(req: Request) {
  const { client, user } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !z.uuid().safeParse(id).success) return Response.json({ error: "Invalid id." }, { status: 400 });
  const { error } = await createAdminClient().from("nova_conversations").delete().eq("id", id).eq("client_id", client.id).eq("user_id", user.id);
  return error ? Response.json({ error: "Could not delete." }, { status: 500 }) : Response.json({ ok: true });
}
