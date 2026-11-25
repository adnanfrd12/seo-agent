import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { todayIn } from "@/lib/analytics/range";
import { DATA_VIEWS, dataSources, detail, history, pageData, type Brief } from "@/lib/ai/intelligence";
import { generateMonth } from "@/lib/roadmap/generate";
import { addTask, deleteTask, getMonth, getTasks, listMonths, monthPatch, progress, taskInput, taskPatch, updateMonth, updateTask, type Actor } from "@/lib/roadmap/store";
import { addMonths, CATEGORIES, CATEGORY_KEYS, categoryLabel, isOpen, monthLabel, monthOf, STATUSES, type RoadmapTask } from "@/lib/roadmap/types";

/**
 * Nova's tools. Every input is validated with Zod on the server; every write is scoped to the active client,
 * checked against the user's role, recorded in roadmap_changes, and reported only after it succeeded.
 * Deleting tasks and replacing a strategy are not run by the model: they become a pending action the user
 * confirms in the chat (see /api/nova/confirm).
 */
export interface NovaCtx {
  admin: SupabaseClient;
  /** the signed-in user's client (RLS applies) */
  db: SupabaseClient;
  client: { id: string; name: string; timezone: string; role: string };
  userId: string;
  conversationId: string;
  canEdit: boolean;
  brief: () => Promise<Brief>;
  /** the dashboard page the user has open while chatting */
  page: { path: string; label: string; text?: string } | null;
}
export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** shown in the chat as an expandable action result */
  action?: { tool: string; ok: boolean; summary: string; detail?: string };
  /** a roadmap change: open views refresh */
  changed?: boolean;
  confirm?: { id: string; title: string; detail: string };
}

const monthArg = z.string().trim().default("current").describe('"current", "next", "previous" or YYYY-MM');
export function resolveMonth(arg: string | undefined, timezone: string): string | null {
  const cur = monthOf(todayIn(timezone));
  const a = (arg ?? "current").trim().toLowerCase();
  if (!a || a === "current" || a === "this" || a === "this month") return cur;
  if (a === "next" || a === "next month") return addMonths(cur, 1);
  if (a === "previous" || a === "last" || a === "last month") return addMonths(cur, -1);
  const m = a.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

const compact = (t: RoadmapTask) => ({ id: t.id, category: t.category, title: t.title, status: t.status, priority: t.priority, impact: t.impact, due_date: t.due_date, source: t.source, checklist: t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : undefined });
const json = (v: unknown) => JSON.stringify(v);

const defs = {
  get_page_data: {
    description: "Read the data shown on the dashboard page the user has open right now. Use it whenever the user says \"this page\", \"this screen\", \"here\" or asks about what they are looking at.",
    schema: z.object({}),
  },
  get_client_data_sources: {
    description: "List the client's connected data sources, what is not available, and the detailed data views that can be requested with get_client_analytics.",
    schema: z.object({}),
  },
  get_client_analytics: {
    description: `Fetch one detailed dataset as JSON (larger than the brief). Views: ${DATA_VIEWS.map((v) => `${v.key} (${v.label})`).join("; ")}.`,
    schema: z.object({ view: z.enum(DATA_VIEWS.map((v) => v.key) as [string, ...string[]]) }),
  },
  get_competitor_analysis: {
    description: "Competitor analysis: competitor sites with keyword counts and estimated traffic, keyword gaps, shared keywords where competitors outrank the client, and competitor threats.",
    schema: z.object({}),
  },
  get_historical_performance: {
    description: "Monthly totals for GA4, Search Console (web) and Business Profile for the last N complete months, for trend and year-over-year questions.",
    schema: z.object({ months: z.number().int().min(2).max(16).default(6) }),
  },
  get_roadmap: {
    description: "One month of the SEO roadmap: summary, objectives, priorities, expected outcomes, progress and the task list (ids, titles, status). Also lists which months exist.",
    schema: z.object({ month: monthArg }),
  },
  get_roadmap_tasks: {
    description: "Full details of roadmap tasks (description, why, evidence, steps, URLs, keywords, checklist). Filter by month, category, status, or one task id.",
    schema: z.object({ month: monthArg, category: z.enum(CATEGORY_KEYS).optional(), status: z.enum(STATUSES).optional(), task_id: z.string().optional() }),
  },
  get_roadmap_progress: {
    description: "Progress of a month: done/open per category, overdue tasks, high-priority open tasks and the latest changes (who changed what).",
    schema: z.object({ month: monthArg }),
  },
  generate_monthly_strategy: {
    description: "Generate the month's full strategy and tasks from the client's data (takes 1-2 minutes). If the month already has tasks, the user must confirm a refresh (completed, started and manually added tasks are always kept). Use focus to steer it, e.g. \"backlinks and local SEO\".",
    schema: z.object({ month: monthArg, focus: z.string().trim().max(400).optional() }),
  },
  add_roadmap_task: {
    description: `Add one task to a month (call it several times to add several). Categories: ${CATEGORIES.map((c) => `${c.key} = ${c.label}`).join(", ")}. Ground "why" in the client's data; give concrete steps; due_date YYYY-MM-DD.`,
    schema: taskInput.extend({ month: monthArg }),
  },
  update_roadmap_task: {
    description: "Change a task: title, description, why, steps, URLs, keywords, category, priority, impact, effort, status, due date; replace the checklist (subtasks) or append items (add_subtasks).",
    schema: taskPatch.extend({ task_id: z.string() }),
  },
  mark_task_completed: {
    description: "Mark a task done (completed: true) or reopen it (completed: false).",
    schema: z.object({ task_id: z.string(), completed: z.boolean().default(true) }),
  },
  delete_roadmap_task: {
    description: "Delete a task. Never runs directly: the user is asked to confirm in the chat.",
    schema: z.object({ task_id: z.string(), reason: z.string().max(300).optional() }),
  },
  update_monthly_strategy: {
    description: "Change a month's summary, focus, objectives, priorities or expected outcomes (lists replace the existing ones). Replacing existing objectives needs the user's confirmation.",
    schema: monthPatch.extend({ month: monthArg }),
  },
} as const;
export type ToolName = keyof typeof defs;
const WRITES = new Set<ToolName>(["generate_monthly_strategy", "add_roadmap_task", "update_roadmap_task", "delete_roadmap_task", "update_monthly_strategy"]);

export function toolDefinitions(): Anthropic.Tool[] {
  return Object.entries(defs).map(([name, d]) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(d.schema, { io: "input" }) as Record<string, unknown>;
    void _drop;
    return { name, description: d.description, input_schema: { ...schema, type: "object" } as Anthropic.Tool.InputSchema };
  });
}

async function pending(ctx: NovaCtx, tool: ToolName, input: unknown, title: string, detailText: string): Promise<ToolOutcome> {
  const { data, error } = await ctx.admin.from("nova_pending_actions").insert({ client_id: ctx.client.id, user_id: ctx.userId, conversation_id: ctx.conversationId, tool, input, summary: title }).select("id").single();
  if (error) return { content: json({ error: "Could not prepare the confirmation." }), isError: true };
  return {
    content: json({ status: "needs_confirmation", message: "Nothing has changed yet. The user sees Confirm / Cancel buttons in the chat; tell them to confirm. Do not call this tool again for the same change." }),
    confirm: { id: data.id, title, detail: detailText },
    action: { tool, ok: true, summary: `Waiting for confirmation: ${title}` },
  };
}

export async function runTool(ctx: NovaCtx, name: string, raw: unknown): Promise<ToolOutcome> {
  const d = defs[name as ToolName];
  if (!d) return { content: json({ error: `Unknown tool ${name}` }), isError: true };
  const p = (d.schema as z.ZodType).safeParse(raw ?? {});
  if (!p.success) return { content: json({ error: "Invalid input", issues: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 8) }), isError: true };
  const a = p.data as Record<string, unknown>;
  const tool = name as ToolName;
  if (WRITES.has(tool) && !ctx.canEdit) return { content: json({ error: "This user has view-only access: only owners and admins can change the roadmap. Explain this; do not claim a change." }), isError: true, action: { tool, ok: false, summary: "Not allowed: view-only access" } };
  const actor: Actor = { kind: "nova", userId: ctx.userId };
  const tz = ctx.client.timezone;
  const needMonth = () => { const m = resolveMonth(a.month as string | undefined, tz); if (!m) throw new BadInput("Month must be current, next, previous or YYYY-MM."); return m; };

  try {
    switch (tool) {
      case "get_page_data": {
        if (!ctx.page) return { content: json({ error: "No page context: ask the user which data they mean." }), isError: true };
        const data = await pageData(ctx.admin, ctx.client.id, await ctx.brief(), ctx.page.path);
        // what the user sees on screen (explanations, settings, tables) alongside the stored data behind it
        const content = ctx.page.text ? `${data}\n\nTEXT VISIBLE ON THE PAGE (as the user sees it):\n${ctx.page.text}` : data;
        return { content, action: { tool, ok: true, summary: `Read this page: ${ctx.page.label}` } };
      }
      case "get_client_data_sources": return { content: json(dataSources(await ctx.brief())), action: { tool, ok: true, summary: "Checked connected data sources" } };
      case "get_client_analytics": {
        const out = await detail(ctx.admin, ctx.client.id, await ctx.brief(), a.view as string);
        return { content: out, action: { tool, ok: true, summary: `Read ${DATA_VIEWS.find((v) => v.key === a.view)?.label ?? a.view}` } };
      }
      case "get_competitor_analysis": return { content: await detail(ctx.admin, ctx.client.id, await ctx.brief(), "competitors"), action: { tool, ok: true, summary: "Read competitor analysis" } };
      case "get_historical_performance": return { content: await history(ctx.db, ctx.client.id, tz, a.months as number), action: { tool, ok: true, summary: `Read ${a.months} months of history` } };
      case "get_roadmap": {
        const month = needMonth();
        const [m, months] = await Promise.all([getMonth(ctx.admin, ctx.client.id, month), listMonths(ctx.admin, ctx.client.id)]);
        const tasks = m ? await getTasks(ctx.admin, ctx.client.id, m.id) : [];
        return {
          content: json({ month: monthLabel(month), exists: Boolean(m), months_with_roadmaps: months.map((x) => x.month.slice(0, 7)),
            summary: m?.summary, focus: m?.focus, objectives: m?.objectives, priorities: m?.priorities, expected_outcomes: m?.expected_outcomes,
            progress: progress(tasks), tasks: tasks.map(compact) }),
          action: { tool, ok: true, summary: `Read the ${monthLabel(month)} roadmap (${tasks.length} tasks)` },
        };
      }
      case "get_roadmap_tasks": {
        let tasks: RoadmapTask[];
        if (a.task_id) {
          const { data } = await ctx.admin.from("roadmap_tasks").select("*").eq("client_id", ctx.client.id).eq("id", String(a.task_id)).limit(1);
          tasks = (data ?? []) as RoadmapTask[];
        } else {
          const m = await getMonth(ctx.admin, ctx.client.id, needMonth());
          tasks = m ? await getTasks(ctx.admin, ctx.client.id, m.id) : [];
          if (a.category) tasks = tasks.filter((t) => t.category === a.category);
          if (a.status) tasks = tasks.filter((t) => t.status === a.status);
        }
        return { content: json(tasks.slice(0, 40).map(({ client_id: _c, month_id: _m, ...t }) => { void _c; void _m; return t; })), action: { tool, ok: true, summary: `Read ${tasks.length} task${tasks.length === 1 ? "" : "s"}` } };
      }
      case "get_roadmap_progress": {
        const month = needMonth();
        const m = await getMonth(ctx.admin, ctx.client.id, month);
        if (!m) return { content: json({ month: monthLabel(month), exists: false }) };
        const tasks = await getTasks(ctx.admin, ctx.client.id, m.id);
        const today = todayIn(tz);
        const { data: changes } = await ctx.admin.from("roadmap_changes").select("created_at, actor, action, summary").eq("client_id", ctx.client.id).eq("month_id", m.id).order("created_at", { ascending: false }).limit(12);
        return {
          content: json({
            month: monthLabel(month), overall: progress(tasks),
            by_category: CATEGORIES.map((c) => ({ category: c.label, ...progress(tasks.filter((t) => t.category === c.key)) })).filter((x) => x.total),
            overdue: tasks.filter((t) => isOpen(t) && t.due_date && t.due_date < today).map(compact),
            high_priority_open: tasks.filter((t) => isOpen(t) && t.priority === "high").map(compact),
            recent_changes: changes ?? [],
          }),
          action: { tool, ok: true, summary: `Checked ${monthLabel(month)} progress` },
        };
      }
      case "generate_monthly_strategy": {
        const month = needMonth();
        const m = await getMonth(ctx.admin, ctx.client.id, month);
        const has = m ? (await getTasks(ctx.admin, ctx.client.id, m.id)).length : 0;
        if (has) return pending(ctx, tool, { month, focus: a.focus ?? null }, `Refresh the ${monthLabel(month)} strategy${a.focus ? ` (focus: ${a.focus})` : ""}`,
          `Open AI-generated tasks nobody has started are replaced with new ones from the latest data. Completed, started, manually added and Nova tasks are kept. ${has} tasks in the month now.`);
        const r = await generateMonth(ctx.admin, ctx.client.id, tz, month, actor, { focus: (a.focus as string) ?? null });
        if (!r.ok) return { content: json({ error: r.error }), isError: true, action: { tool, ok: false, summary: `Strategy not generated: ${r.error}` } };
        return { content: json({ ok: true, month: monthLabel(month), tasks_added: r.added, dropped_for_missing_evidence: r.dropped }), changed: true, action: { tool, ok: true, summary: `Generated the ${monthLabel(month)} strategy: ${r.added} tasks` } };
      }
      case "add_roadmap_task": {
        const { month: _m, ...input } = a; void _m;
        const r = await addTask(ctx.admin, ctx.client.id, needMonth(), input as z.input<typeof taskInput>, actor, { source: "nova" });
        if (!r.ok) return { content: json({ error: r.error }), isError: true, action: { tool, ok: false, summary: r.error } };
        return { content: json({ ok: true, task_id: r.value.id, title: r.value.title, category: categoryLabel(r.value.category), due_date: r.value.due_date }), changed: true, action: { tool, ok: true, summary: `Added "${r.value.title}" to ${categoryLabel(r.value.category)}` } };
      }
      case "update_roadmap_task": {
        const { task_id, ...patch } = a;
        const r = await updateTask(ctx.admin, ctx.client.id, String(task_id), patch as z.input<typeof taskPatch>, actor);
        if (!r.ok) return { content: json({ error: r.error }), isError: true, action: { tool, ok: false, summary: r.error } };
        return { content: json({ ok: true, task: compact(r.value) }), changed: true, action: { tool, ok: true, summary: `Updated "${r.value.title}" (${Object.keys(patch).join(", ")})` } };
      }
      case "mark_task_completed": {
        const r = await updateTask(ctx.admin, ctx.client.id, String(a.task_id), { status: a.completed ? "done" : "todo" }, actor);
        if (!r.ok) return { content: json({ error: r.error }), isError: true, action: { tool, ok: false, summary: r.error } };
        return { content: json({ ok: true, task: compact(r.value) }), changed: true, action: { tool, ok: true, summary: `${a.completed ? "Completed" : "Reopened"} "${r.value.title}"` } };
      }
      case "delete_roadmap_task": {
        const { data: t } = await ctx.admin.from("roadmap_tasks").select("title, category").eq("client_id", ctx.client.id).eq("id", String(a.task_id)).maybeSingle();
        if (!t) return { content: json({ error: "That task doesn't exist for this client." }), isError: true };
        return pending(ctx, tool, { task_id: a.task_id }, `Delete "${t.title}"`, `${categoryLabel(t.category)}${a.reason ? ` · ${String(a.reason).replace(/[.\s]+$/, "")}` : ""}. This can't be undone.`);
      }
      case "update_monthly_strategy": {
        const { month: _m, ...patch } = a; void _m;
        const month = needMonth();
        const cur = await getMonth(ctx.admin, ctx.client.id, month);
        if (patch.objectives && (cur?.objectives?.length ?? 0) > 0) {
          return pending(ctx, tool, { month, ...patch }, `Replace the ${monthLabel(month)} objectives`, (patch.objectives as { title: string }[]).map((o) => `• ${o.title}`).join("\n"));
        }
        const r = await updateMonth(ctx.admin, ctx.client.id, month, patch as z.input<typeof monthPatch>, actor);
        if (!r.ok) return { content: json({ error: r.error }), isError: true, action: { tool, ok: false, summary: r.error } };
        return { content: json({ ok: true, month: monthLabel(month), updated: Object.keys(patch) }), changed: true, action: { tool, ok: true, summary: `Updated the ${monthLabel(month)} strategy (${Object.keys(patch).join(", ")})` } };
      }
    }
  } catch (e) {
    if (e instanceof BadInput) return { content: json({ error: e.message }), isError: true };
    return { content: json({ error: "The tool failed. Tell the user it didn't work; do not claim success." }), isError: true, action: { tool, ok: false, summary: "Failed" } };
  }
  return { content: json({ error: "Unhandled tool" }), isError: true };
}

class BadInput extends Error {}

/** Runs a confirmed pending action (called from the chat's Confirm button, never by the model). */
export async function runConfirmed(admin: SupabaseClient, clientId: string, timezone: string, userId: string, tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; message: string; changed: boolean }> {
  const actor: Actor = { kind: "nova", userId };
  if (tool === "delete_roadmap_task") {
    const r = await deleteTask(admin, clientId, String(input.task_id), actor);
    return r.ok ? { ok: true, message: r.message, changed: true } : { ok: false, message: r.error, changed: false };
  }
  if (tool === "generate_monthly_strategy") {
    const month = String(input.month);
    const r = await generateMonth(admin, clientId, timezone, month, actor, { focus: (input.focus as string | null) ?? null });
    return r.ok ? { ok: true, message: `Refreshed the ${monthLabel(month)} strategy: ${r.added} new tasks, ${r.kept} kept, ${r.removed} open AI tasks replaced.`, changed: true } : { ok: false, message: r.error, changed: false };
  }
  if (tool === "update_monthly_strategy") {
    const { month, ...patch } = input;
    const r = await updateMonth(admin, clientId, String(month), patch as z.input<typeof monthPatch>, actor);
    return r.ok ? { ok: true, message: `Updated the ${monthLabel(String(month))} strategy.`, changed: true } : { ok: false, message: r.error, changed: false };
  }
  return { ok: false, message: "Unknown action.", changed: false };
}
