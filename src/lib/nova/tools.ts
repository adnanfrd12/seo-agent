import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { EDITORS, json, ToolError, type ExecCtx, type ExecResult, type NovaCtx, type NovaTool, type Role, type ToolOutcome, type WriteTool } from "./kit";
import { NOT_IN_PLAN, toolAllowed } from "./pages";
import { tools as aiWork } from "./domains/ai-work";
import { tools as contentOps } from "./domains/content-ops";
import { tools as data } from "./domains/data";
import { tools as roadmap } from "./domains/roadmap";
import { tools as searchConfig } from "./domains/search-config";
import { tools as seoRuns } from "./domains/seo-runs";
import { tools as tracking } from "./domains/tracking";

export type { NovaCtx, ToolOutcome } from "./kit";

/**
 * Nova's tool registry. Each area of the dashboard contributes a module in ./domains (see ./kit for the rules).
 * Read tools run immediately. Write tools only prepare a change: it becomes a pending action that the user
 * confirms in the chat, and runConfirmed() executes it for that user and client, once.
 */
const ALL: NovaTool[] = [...data, ...roadmap, ...aiWork, ...tracking, ...searchConfig, ...seoRuns, ...contentOps];
const BY_NAME = new Map<string, NovaTool>();
for (const t of ALL) {
  if (BY_NAME.has(t.name)) throw new Error(`Duplicate Nova tool name: ${t.name}`);
  BY_NAME.set(t.name, t);
}
export const toolNames = () => [...BY_NAME.keys()];

/** A pending action can be confirmed for this long; after that the data may have changed, so Nova asks again. */
const PENDING_TTL_MS = 24 * 3600_000;

const rolesOf = (t: WriteTool) => t.roles ?? EDITORS;
export const canRun = (t: NovaTool, role: string) => t.kind === "read" || rolesOf(t).includes(role as Role);

let defsCache: Anthropic.Tool[] | null = null;
/** The tools offered to Claude: all of them, minus those outside the organization's pages (`enabled`, null = all). */
export function toolDefinitions(enabled?: readonly string[] | null): Anthropic.Tool[] {
  const all = (defsCache ??= ALL.map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    void _drop;
    const description = t.kind === "write" ? `${t.description} (Prepares the change; it happens only after the user confirms in the chat.)` : t.description;
    return { name: t.name, description, input_schema: { ...schema, type: "object" } as Anthropic.Tool.InputSchema };
  }));
  return enabled ? all.filter((d) => toolAllowed(d.name, enabled)) : all;
}

const messageOf = (e: unknown) => (e instanceof ToolError ? e.message : null);

export async function runTool(ctx: NovaCtx, name: string, raw: unknown): Promise<ToolOutcome> {
  const t = BY_NAME.get(name);
  if (!t) return { content: json({ error: `Unknown tool ${name}` }), isError: true };
  if (!toolAllowed(name, ctx.enabledPages)) return { content: json({ error: NOT_IN_PLAN }), isError: true };
  const p = (t.schema as z.ZodType).safeParse(raw ?? {});
  if (!p.success) return { content: json({ error: "Invalid input", issues: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 8) }), isError: true };

  if (t.kind === "read") {
    try {
      const out = await t.run(ctx, p.data);
      if (typeof out !== "string") return out;
      return { content: out, action: { tool: name, ok: true, summary: t.summary?.(p.data) ?? name.replace(/_/g, " ") } };
    } catch (e) {
      const m = messageOf(e);
      if (!m) console.error(`nova tool ${name}`, e);
      return { content: json({ error: m ?? "The tool failed. Tell the user it didn't work." }), isError: true, action: m ? undefined : { tool: name, ok: false, summary: "Failed" } };
    }
  }

  if (!canRun(t, ctx.client.role)) {
    return { content: json({ error: `The user's role (${ctx.client.role}) can't make this change: only ${rolesOf(t).join(" or ")}. Explain this; do not claim a change.` }), isError: true, action: { tool: name, ok: false, summary: "Not allowed for this role" } };
  }
  try {
    const prep = await t.prepare(ctx, p.data);
    if ("error" in prep) return { content: json({ error: prep.error }), isError: true };
    const input = prep.input ?? (p.data as Record<string, unknown>);
    if (!(t.schema as z.ZodType).safeParse(input).success) throw new Error(`prepare() of ${name} returned an input that fails its schema`);
    const { data: row, error } = await ctx.admin.from("nova_pending_actions")
      .insert({ client_id: ctx.client.id, user_id: ctx.userId, conversation_id: ctx.conversationId, tool: name, input, summary: prep.title.slice(0, 300) })
      .select("id").single();
    if (error || !row) return { content: json({ error: "Could not prepare the confirmation." }), isError: true };
    return {
      content: json({ status: "needs_confirmation", change: prep.title, message: "Nothing has changed yet. The user sees Confirm / Cancel for this change in the chat. Do not call the tool again for the same change." }),
      confirm: { id: row.id, title: prep.title, detail: prep.detail ?? "", ...(prep.expectSeconds ? { expectSeconds: prep.expectSeconds } : {}) },
      action: { tool: name, ok: true, summary: `Waiting for your confirmation: ${prep.title}` },
    };
  } catch (e) {
    const m = messageOf(e);
    if (!m) console.error(`nova tool ${name}`, e);
    return { content: json({ error: m ?? "The tool failed. Tell the user it didn't work; do not claim success." }), isError: true, action: m ? undefined : { tool: name, ok: false, summary: "Failed" } };
  }
}

/** Checks a confirmed pending action against the user's role and the organization's pages (null = allowed). */
export function confirmBlocked(tool: string, role: string, enabled?: readonly string[] | null): string | null {
  const t = BY_NAME.get(tool);
  if (!t || t.kind !== "write") return "Unknown action.";
  if (!toolAllowed(tool, enabled)) return "This part of the dashboard isn't available to your organization.";
  return canRun(t, role) ? null : `Your role (${role}) can't make this change.`;
}

/** Runs a confirmed pending action (called from the chat's Confirm button, never by the model). */
export async function runConfirmed(x: ExecCtx, tool: string, input: unknown, createdAt: string): Promise<ExecResult> {
  const t = BY_NAME.get(tool);
  if (!t || t.kind !== "write") return { ok: false, message: "Unknown action." };
  if (Date.now() - Date.parse(createdAt) > PENDING_TTL_MS) return { ok: false, message: "This request is more than a day old. Ask Nova again so it uses the latest data." };
  const p = (t.schema as z.ZodType).safeParse(input ?? {});
  if (!p.success) return { ok: false, message: "The stored request is no longer valid. Ask Nova again." };
  try {
    return await t.execute(x, p.data);
  } catch (e) {
    const m = messageOf(e);
    if (!m) console.error(`nova execute ${tool}`, e);
    return { ok: false, message: m ?? (e instanceof Error && e.message ? e.message.slice(0, 300) : "It didn't work.") };
  }
}

/** For tests and tooling: every tool's name and kind. */
export const toolIndex = () => ALL.map((t) => ({ name: t.name, kind: t.kind, roles: t.kind === "write" ? rolesOf(t) : (["owner", "admin", "viewer"] as Role[]) }));
export type { SupabaseClient };
