import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { runConfirmed } from "@/lib/nova/tools";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "@/lib/revalidate";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const body = z.object({ id: z.uuid(), decision: z.enum(["confirm", "cancel"]) });

/**
 * The user's answer to a Nova action that needed confirmation (deleting a task, refreshing or replacing a
 * strategy). Runs only for the user who was asked, in the client it was asked for, and only once.
 */
export async function POST(req: Request) {
  const { client, user } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  if (!["owner", "admin"].includes(client.role)) return Response.json({ error: "Only owners and admins can change the roadmap." }, { status: 403 });

  const admin = createAdminClient();
  // claim it atomically: a second click (or another tab) finds it already handled
  const { data: action } = await admin.from("nova_pending_actions").update({ status: p.data.decision === "cancel" ? "cancelled" : "done", resolved_at: new Date().toISOString() })
    .eq("id", p.data.id).eq("client_id", client.id).eq("user_id", user.id).eq("status", "pending")
    .select("id, tool, input, summary, conversation_id").maybeSingle();
  if (!action) return Response.json({ error: "This action was already handled or has expired." }, { status: 409 });

  let message: string, ok = true, changed = false;
  if (p.data.decision === "cancel") message = `Cancelled: ${action.summary}.`;
  else {
    const r = await runConfirmed(admin, client.id, client.timezone, user.id, action.tool, action.input as Record<string, unknown>);
    ok = r.ok; changed = r.changed; message = r.ok ? r.message : `Couldn't complete it: ${r.message}`;
    await admin.from("nova_pending_actions").update({ status: r.ok ? "done" : "failed", result: message }).eq("id", action.id);
  }
  // the outcome becomes part of the conversation, so Nova knows on the next message
  if (action.conversation_id) {
    await admin.from("nova_messages").insert({ conversation_id: action.conversation_id, client_id: client.id, user_id: user.id, role: "assistant", content: message,
      actions: [{ tool: action.tool, ok, summary: p.data.decision === "cancel" ? `Cancelled: ${action.summary}` : message }] });
  }
  if (changed) revalidatePath("/roadmap");
  return Response.json({ ok, message, changed });
}
