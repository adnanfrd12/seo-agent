import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiErrorMessage, anthropic } from "@/lib/ai/claude";
import { brief, briefText, type Brief } from "@/lib/ai/intelligence";
import { getSession } from "@/lib/analytics/client-context";
import { todayIn } from "@/lib/analytics/range";
import { clientSettings } from "@/lib/aiqw/run";
import { callCost } from "@/lib/aiqw/settings";
import { claudeMonthSpend, recordAskCost } from "@/lib/aiqw/store";
import { runTool, toolDefinitions, type NovaCtx } from "@/lib/nova/tools";
import { monthLabel, monthOf } from "@/lib/roadmap/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const body = z.object({
  conversationId: z.uuid().nullable().optional(),
  message: z.string().trim().min(1).max(4000),
  /** the dashboard page open while chatting (label is display text only; data is chosen from the path on the server) */
  page: z.object({ path: z.string().regex(/^\/[A-Za-z0-9_\-/]{0,150}$/), label: z.string().trim().max(120) }).nullable().optional(),
});
type Action = { tool: string; ok: boolean; summary: string; detail?: string };

function system(name: string, clientName: string, role: string, canEdit: boolean, today: string, page: { path: string; label: string } | null) {
  return `You are Nova, the AI SEO strategist inside the SEO Insights dashboard, working alongside ${name || "the user"} on the client "${clientName}".

Today is ${today}; the current roadmap month is ${monthLabel(monthOf(today))}. The user's role is ${role}${canEdit ? "" : " (view-only: you can analyse and explain, and mark tasks done, but not add, edit or delete roadmap items)"}.

${page ? `The user has the dashboard page "${page.label.replace(/["\n]/g, " ")}" (${page.path}) open. "This page", "this screen" or "here" means it: call get_page_data to read what it shows before answering.\n\n` : ""}What you do: answer questions about the client's connected analytics, analyse website and social performance, compare competitors, find problems and growth opportunities, write personalised strategies, explain roadmap tasks, and manage the roadmap (add, update, complete, reprioritise and reschedule tasks, add checklists, update monthly strategies) with your tools.

Rules:
- Ground everything in the client's data: the evidence brief below, or what your tools return. Never invent metrics, pages, keywords, competitors, findings or results. If the data isn't there, say what is missing and what to connect.
- Use get_client_analytics, get_competitor_analysis or get_historical_performance when the brief isn't detailed enough. Fetch only what the question needs.
- Before changing tasks, read them with get_roadmap or get_roadmap_tasks so you use real task ids. Avoid duplicates.
- Only say a change was made after the tool returned ok. If a tool returns an error, say plainly that it didn't work. For needs_confirmation results, tell the user to press Confirm in the chat; nothing has changed yet.
- When you add tasks, make them specific to this client (why, with the numbers; concrete steps; affected pages and keywords from the data; a due date in the month).
- Small numbers are noise; estimates (DataForSEO) are estimates; effects are hypotheses, never guarantees.
- Write clearly for a business owner: short paragraphs, bullet lists, and tables for comparisons. Use Markdown. Keep answers focused; no filler.`;
}

export async function POST(req: Request) {
  const { client, user } = await getSession();
  if (!client) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Write a message (up to 4,000 characters)." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });

  const admin = createAdminClient();
  const [{ settings }, spent] = await Promise.all([clientSettings(admin, client.id), claudeMonthSpend(admin, client.id)]);
  if (spent >= settings.monthlyBudget) return Response.json({ error: `The monthly Claude budget ($${settings.monthlyBudget}) is used up. An owner can raise it in AI Quick Wins → Settings.` }, { status: 402 });

  // the conversation must belong to this user and client
  let conversationId = p.data.conversationId ?? null;
  if (conversationId) {
    const { data } = await admin.from("nova_conversations").select("id").eq("id", conversationId).eq("client_id", client.id).eq("user_id", user.id).maybeSingle();
    if (!data) conversationId = null;
  }
  if (!conversationId) {
    const { data, error } = await admin.from("nova_conversations").insert({ client_id: client.id, user_id: user.id, title: p.data.message.replace(/\s+/g, " ").slice(0, 80) }).select("id").single();
    if (error) return Response.json({ error: "Could not start the conversation (apply migration 20261125000025)." }, { status: 500 });
    conversationId = data.id as string;
  }
  const { data: past } = await admin.from("nova_messages").select("role, content, actions").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(16);
  await admin.from("nova_messages").insert({ conversation_id: conversationId, client_id: client.id, user_id: user.id, role: "user", content: p.data.message });

  const history: Anthropic.MessageParam[] = (past ?? []).reverse().filter((m) => m.content || (m.actions as Action[]).length).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.role === "assistant" && (m.actions as Action[]).length ? `${m.content}\n\n[Actions taken: ${(m.actions as Action[]).map((a) => `${a.ok ? "✓" : "✗"} ${a.summary}`).join("; ")}]` : m.content || "(no text)",
  }));
  // the API needs strictly alternating turns that start with the user
  const messages: Anthropic.MessageParam[] = [];
  for (const m of [...history, { role: "user" as const, content: p.data.message }]) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else if (messages.length || m.role === "user") messages.push({ ...m });
  }

  let cachedBrief: Brief | null = null;
  const getBrief = async () => (cachedBrief ??= await brief(admin, client.id, client.timezone));
  const ctx: NovaCtx = {
    admin, db: await createClient(), client: { id: client.id, name: client.name, timezone: client.timezone, role: client.role },
    userId: user.id, conversationId, canEdit: ["owner", "admin"].includes(client.role), brief: getBrief, page: p.data.page ?? null,
  };
  const today = todayIn(client.timezone);
  const firstName = (user.fullName ?? "").split(" ")[0];
  const tools = toolDefinitions();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Record<string, unknown>) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`)); } catch { /* client went away */ } };
      send({ t: "start", conversationId });
      let text = "", cost = 0;
      const actions: Action[] = [];
      try {
        const b = await getBrief();
        const sys: Anthropic.TextBlockParam[] = [
          { type: "text", text: system(firstName, client.name, client.role, ctx.canEdit, today, ctx.page) },
          { type: "text", text: `CLIENT DATA BRIEF (compact evidence package; ask tools for detail):\n${briefText(b)}`, cache_control: { type: "ephemeral" } },
        ];
        for (let turn = 0; turn < 8; turn++) {
          const s = anthropic().messages.stream({
            model: settings.model, max_tokens: 8000, thinking: { type: "adaptive" }, output_config: { effort: "medium" },
            system: sys, tools, messages,
          }, { signal: req.signal });
          s.on("text", (delta) => { text += delta; send({ t: "text", v: delta }); });
          const msg = await s.finalMessage();
          cost += callCost(settings.model, msg.usage);
          if (msg.stop_reason === "refusal") { send({ t: "text", v: "\n\nI can't help with that request." }); text += "\n\nI can't help with that request."; break; }
          if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
          const uses = msg.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
          if (!uses.length) break;
          if (msg.stop_reason === "max_tokens") { send({ t: "text", v: "\n\n(The answer was cut off.)" }); break; }
          messages.push({ role: "assistant", content: msg.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const u of uses) {
            send({ t: "tool", id: u.id, name: u.name, status: "running" });
            const out = await runTool(ctx, u.name, u.input);
            if (out.action) { actions.push(out.action); send({ t: "tool", id: u.id, name: u.name, status: out.action.ok && !out.isError ? "done" : "failed", summary: out.action.summary }); }
            else send({ t: "tool", id: u.id, name: u.name, status: out.isError ? "failed" : "done" });
            if (out.confirm) send({ t: "confirm", ...out.confirm });
            if (out.changed) send({ t: "changed" });
            results.push({ type: "tool_result", tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
          }
          messages.push({ role: "user", content: results });
          if (text && !text.endsWith("\n")) { text += "\n\n"; send({ t: "text", v: "\n\n" }); }
        }
      } catch (e) {
        if (!(e instanceof Anthropic.APIUserAbortError)) {
          const m = aiErrorMessage(e);
          send({ t: "error", message: m });
          if (!text) text = `(${m})`;
        }
      }
      cost = Number(cost.toFixed(4));
      const { data: saved } = await admin.from("nova_messages").insert({ conversation_id: conversationId, client_id: client.id, user_id: user.id, role: "assistant", content: text.trim(), actions, cost_usd: cost }).select("id").single();
      await admin.from("nova_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
      if (cost > 0) await recordAskCost(admin, client.id, cost).catch(() => undefined);
      send({ t: "done", conversationId, messageId: saved?.id ?? null });
      try { controller.close(); } catch { /* closed */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
