import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Brief } from "@/lib/ai/intelligence";

/**
 * The building blocks of Nova's tools. Every area of the dashboard (roadmap, AI work lists, tracked lists, ...)
 * has a module in ./domains that exports `tools: NovaTool[]` built with `read()` and `write()`.
 *
 * - A read tool runs straight away and returns data to the model.
 * - A write tool NEVER changes anything when the model calls it. `prepare` validates the request, checks that
 *   the records exist, and describes the change; Nova then shows a Confirm / Cancel card in the chat. Only when
 *   the user presses Confirm does `/api/nova/confirm` call `execute` (once, for that user and client). The input
 *   is stored with the pending action and validated against the tool's schema again before `execute`.
 */
export type Role = "owner" | "admin" | "viewer";
export const EDITORS: Role[] = ["owner", "admin"];

export interface NovaCtx {
  /** service-role client: every query MUST be scoped to ctx.client.id */
  admin: SupabaseClient;
  /** the signed-in user's client (RLS applies) */
  db: SupabaseClient;
  client: { id: string; name: string; timezone: string; role: string };
  userId: string;
  conversationId: string;
  /** owner or admin */
  canEdit: boolean;
  brief: () => Promise<Brief>;
  /** the dashboard page the user has open while chatting */
  page: { path: string; label: string; text?: string } | null;
  /** the organization's page access (null/undefined = every page): tools outside it aren't offered or run (./pages) */
  enabledPages?: readonly string[] | null;
  /** the user's role in the client's organization (owner | admin | member | viewer), null when unknown */
  orgRole?: string | null;
}

/** What `execute` gets when the user confirms. The request also carries the user's session, so the dashboard's
 * own server actions (which read the session and check the role themselves) can be called from `execute`. */
export interface ExecCtx {
  admin: SupabaseClient;
  client: { id: string; name: string; timezone: string; role: string };
  userId: string;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** shown in the chat as an action result */
  action?: { tool: string; ok: boolean; summary: string; detail?: string };
  /** data changed: open views refresh */
  changed?: boolean;
  confirm?: { id: string; title: string; detail: string; expectSeconds?: number };
}

/** The description of a pending change on the Confirm card. */
export interface Preview {
  /** one line, imperative: `Delete "Fix title tags"`, `Add 3 keywords to rank tracking` */
  title: string;
  /** what exactly will happen: the items, old → new values, costs, what can't be undone */
  detail?: string;
  /** stored and passed to `execute` instead of the model's input (must still satisfy the tool's schema) */
  input?: Record<string, unknown>;
  /** for runs that take a while after Confirm: about how many seconds (the card shows progress meanwhile) */
  expectSeconds?: number;
}

export interface ExecResult {
  ok: boolean;
  /** shown to the user and saved in the conversation: what happened, or why it didn't */
  message: string;
  /** dashboard routes to refresh, e.g. ["/rank-tracking"] */
  paths?: string[];
  /** the SEO roadmap changed (open roadmap views reload) */
  roadmap?: boolean;
}

interface Base<S extends z.ZodType> {
  name: string;
  /** for the model: what it does and when to use it, in one or two short sentences */
  description: string;
  schema: S;
}
export interface ReadTool<S extends z.ZodType = z.ZodType> extends Base<S> {
  kind: "read";
  /** return the data (JSON string or text) or a full outcome; throw ToolError for a clean error message */
  run(ctx: NovaCtx, input: z.output<S>): Promise<string | ToolOutcome>;
  /** the activity line in the chat, e.g. "Read 12 tracked keywords" */
  summary?: (input: z.output<S>) => string;
}
export interface WriteTool<S extends z.ZodType = z.ZodType> extends Base<S> {
  kind: "write";
  /** who may request and confirm it (default: owners and admins) */
  roles?: Role[];
  /** validate, look things up, describe the change. Return { error } (or throw ToolError) when it can't be done. Must not change data. */
  prepare(ctx: NovaCtx, input: z.output<S>): Promise<Preview | { error: string }>;
  /** make the change; runs only after the user confirmed */
  execute(x: ExecCtx, input: z.output<S>): Promise<ExecResult>;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NovaTool = ReadTool<any> | WriteTool<any>;

export const read = <S extends z.ZodType>(t: Omit<ReadTool<S>, "kind">): ReadTool<S> => ({ kind: "read", ...t });
export const write = <S extends z.ZodType>(t: Omit<WriteTool<S>, "kind">): WriteTool<S> => ({ kind: "write", ...t });

/** A clean, user-safe error from inside a tool (shown to the model as the error message). */
export class ToolError extends Error {}

export const json = (v: unknown) => JSON.stringify(v);

/** Maps the `{ ok, message | error }` results of the dashboard's server actions to an ExecResult. */
export function fromAction(r: { ok: boolean; message?: string; error?: string } | null | undefined, fallback: string, paths?: string[]): ExecResult {
  if (!r) return { ok: false, message: "No response." };
  return r.ok ? { ok: true, message: r.message || fallback, paths } : { ok: false, message: r.error || r.message || "It didn't work." };
}

/** "3 keywords", "1 keyword" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A bullet list for Confirm card details (at most `max` lines, then "and N more"). */
export function bullets(items: string[], max = 12): string {
  const shown = items.slice(0, max).map((s) => `• ${s}`);
  if (items.length > max) shown.push(`…and ${items.length - max} more`);
  return shown.join("\n");
}
