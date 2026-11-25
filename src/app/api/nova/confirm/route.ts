import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { confirmBlocked, runConfirmed } from "@/lib/nova/tools";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const body = z.object({ id: z.uuid(), decision: z.enum(["confirm", "cancel"]) });

/**
 * The user's answer to a change Nova prepared. Nova never changes data itself: every create, update, delete or
 * run waits here for the user's Confirm. It runs only for the user who was asked, in the client it was asked
 * for, for a role allowed to make that change, and only once.
 */
export async function POST(req: Request) {
  const { client, user } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const admin = createAdminClient();
  const own = () => admin.from("nova_pending_actions").select("id, tool").eq("id", p.data.id).eq("client_id", client.id).eq("user_id", user.id).eq("status", "pending").maybeSingle();
  const { data: pend } = await own();
  if (!pend) return Response.json({ error: "This action was already handled or has expired." }, { status: 409 });
  if (p.data.decision === "confirm") {
    const blocked = confirmBlocked(pend.tool, client.role);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
  }

  // claim it atomically: a second click (or another tab) finds it already handled
  const { data: action } = await admin.from("nova_pending_actions").update({ status: p.data.decision === "cancel" ? "cancelled" : "done", resolved_at: new Date().toISOString() })
    .eq("id", p.data.id).eq("client_id", client.id).eq("user_id", user.id).eq("status", "pending")
    .select("id, tool, input, summary, conversation_id, created_at").maybeSingle();
  if (!action) return Response.json({ error: "This action was already handled or has expired." }, { status: 409 });

  let message: string, ok = true, roadmap = false, paths: string[] = [];
  if (p.data.decision === "cancel") message = `Cancelled: ${action.summary}.`;
  else {
    const r = await runConfirmed({ admin, client: { id: client.id, name: client.name, timezone: client.timezone, role: client.role }, userId: user.id }, action.tool, action.input, action.created_at);
    ok = r.ok; roadmap = Boolean(r.roadmap); paths = r.paths ?? [];
    message = r.ok ? r.message : `Couldn't complete it: ${r.message}`;
    await admin.from("nova_pending_actions").update({ status: r.ok ? "done" : "failed", result: message.slice(0, 2000) }).eq("id", action.id);
  }
  // the outcome becomes part of the conversation, so Nova knows on the next message
  if (action.conversation_id) {
    await admin.from("nova_messages").insert({ conversation_id: action.conversation_id, client_id: client.id, user_id: user.id, role: "assistant", content: message,
      actions: [{ tool: action.tool, ok, summary: p.data.decision === "cancel" ? `Cancelled: ${action.summary}` : message.slice(0, 300) }] });
  }
  const changed = p.data.decision === "confirm" && ok;
  if (changed) for (const path of new Set([...paths, ...(roadmap ? ["/roadmap"] : [])])) revalidatePath(path);
  return Response.json({ ok, message, changed, roadmap });
}
