import "server-only";
import { z } from "zod";
import { todayIn } from "@/lib/analytics/range";
import { generateMonth } from "@/lib/roadmap/generate";
import {
  addTask, addTasks, applyChecklist, bulkPatch, checklistOps, createMonth, deleteMonth, deleteTask, deleteTasks, editChecklist, getMonth, getTasks,
  getTasksByIds, keyOf, listChanges, listMonths, monthIndex, monthPatch, moveTasks, planAdd, planMove, planUpdate, progress, searchTasks, taskInput,
  taskKeys, taskPatch, taskStats, updateMonth, updateTask, updateTasks, writesStrategy, type Actor, type ChangeEntry,
} from "@/lib/roadmap/store";
import { addMonths, CATEGORIES, CATEGORY_KEYS, categoryLabel, dedupeKey, isOpen, LEVELS, monthLabel, monthOf, STATUS_LABEL, STATUSES, type RoadmapTask } from "@/lib/roadmap/types";
import { bullets, json, plural, read, ToolError, write, type ExecCtx, type NovaCtx, type NovaTool } from "../kit";

/**
 * The SEO roadmap: months (strategy, objectives) and their tasks with checklists. Nova reads and searches across
 * months, creates and deletes months, adds, changes, moves, copies and deletes many tasks at once, and edits
 * checklists. Every change waits for the user's Confirm and is logged in roadmap_changes (actor "nova").
 */

export const monthArg = z.string().trim().default("current").describe('"current", "next", "previous" or YYYY-MM');
export function resolveMonth(arg: string | undefined, timezone: string): string | null {
  const cur = monthOf(todayIn(timezone));
  const a = (arg ?? "current").trim().toLowerCase();
  if (!a || a === "current" || a === "this" || a === "this month") return cur;
  if (a === "next" || a === "next month") return addMonths(cur, 1);
  if (a === "previous" || a === "last" || a === "last month") return addMonths(cur, -1);
  const m = a.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}-01` : null;
}
export const needMonth = (arg: string | undefined, timezone: string) => {
  const m = resolveMonth(arg, timezone);
  if (!m) throw new ToolError("Month must be current, next, previous or YYYY-MM.");
  return m;
};
export const novaActor = (userId: string): Actor => ({ kind: "nova", userId });
export const compact = (t: Pick<RoadmapTask, "id" | "category" | "title" | "status" | "priority" | "impact" | "due_date" | "source" | "subtasks">) => ({ id: t.id, category: t.category, title: t.title, status: t.status, priority: t.priority, impact: t.impact, due_date: t.due_date, source: t.source, checklist: t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : undefined });
const ROADMAP = { paths: ["/roadmap"], roadmap: true };

/** One task of this client, or a ToolError. */
export async function taskOf(ctx: Pick<NovaCtx, "admin" | "client"> | ExecCtx, id: string): Promise<RoadmapTask> {
  const { data } = await ctx.admin.from("roadmap_tasks").select("*").eq("client_id", ctx.client.id).eq("id", id).maybeSingle();
  if (!data) throw new ToolError(`Task ${id} doesn't exist for this client. Read the roadmap first to get real task ids.`);
  return data as RoadmapTask;
}

/** These tasks of this client (in the order given), or a ToolError naming the ids that don't exist. */
async function tasksOf(ctx: Pick<NovaCtx, "admin" | "client">, ids: string[]): Promise<RoadmapTask[]> {
  const want = [...new Set(ids.map((s) => s.trim().toLowerCase()))];
  const found = await getTasksByIds(ctx.admin, ctx.client.id, want);
  const have = new Set(found.map((t) => t.id)), missing = want.filter((id) => !have.has(id));
  if (missing.length) throw new ToolError(`${missing.length === 1 ? "This task id doesn't" : `${missing.length} task ids don't`} exist for this client: ${missing.slice(0, 5).join(", ")}. Use ids from get_roadmap, get_roadmap_tasks or search_roadmap_tasks.`);
  return found;
}

const describePatch = (p: Record<string, unknown>) => Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => {
  const val = Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === "object" && x && "text" in x ? (x as { text: string }).text : String(x))).join("; ") : "(empty)") : v === null ? "(none)" : String(v);
  return `${k.replace(/_/g, " ")}: ${val.length > 160 ? `${val.slice(0, 157)}…` : val}`;
});

/* ------------------------------------------------------------------ formatting for Confirm cards and read outputs */

/** A month that must be named (creating, deleting, moving to): no default. */
const monthReq = z.string().trim().min(1).describe('"current", "next", "previous" or YYYY-MM');
const taskIds = z.array(z.string()).min(1).max(60);
const ym = (month: string) => month.slice(0, 7);
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const q = (s: string, n = 90) => `"${clip(s, n)}"`;
const statusText = (s: string) => (STATUS_LABEL as Record<string, string>)[s]?.toLowerCase() ?? s;
/** "Nov 20" (with the year when it isn't this year), or "none". */
const day = (iso: string | null | undefined, today: string) => (!iso ? "none"
  : new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" }));
const FIELD: Record<string, string> = { due_date: "due date", subtasks: "checklist", urls: "pages", expected_outcomes: "expected outcomes" };
const fieldName = (k: string) => FIELD[k] ?? k.replace(/_/g, " ");

/** A field's value as the user reads it. */
function show(k: string, v: unknown, today: string): string {
  if (v === null || v === undefined || v === "") return "none";
  if (k === "due_date") return day(String(v), today);
  if (k === "category") return categoryLabel(String(v));
  if (k === "status") return statusText(String(v));
  if (k === "month" && typeof v === "string" && /^\d{4}-\d{2}/.test(v)) return monthLabel(`${v.slice(0, 7)}-01`);
  if (Array.isArray(v)) {
    if (!v.length) return "(empty)";
    return v.map((x) => {
      if (!x || typeof x !== "object") return String(x);
      const o = x as { title?: string; text?: string; done?: boolean };
      return o.text !== undefined ? `${o.text}${o.done ? " ✓" : ""}` : String(o.title ?? "");
    }).join("; ");
  }
  return String(v);
}

/** One line per field that really changes: "priority: medium → high"; long texts and lists show the new value. */
function changeLines(before: Record<string, unknown>, patch: Record<string, unknown>, today: string): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "add_subtasks") {
      if ((v as string[]).length) out.push(`checklist: add ${(v as string[]).map((x) => q(x, 60)).join(", ")}`);
      continue;
    }
    const old = before[k];
    if (k === "subtasks") {
      const items = (xs: { text: string; done?: boolean }[]) => xs.map((s) => `${s.text}${s.done ? " ✓" : ""}`);
      const a = items((old as { text: string; done?: boolean }[] | undefined) ?? []), b = items(v as { text: string; done?: boolean }[]);
      if (json(a) !== json(b)) out.push(`checklist (${a.length} → ${b.length} items): ${clip(b.join("; ") || "(empty)", 220)}`);
      continue;
    }
    if (json(old ?? null) === json(v ?? null)) continue;
    if (Array.isArray(v)) out.push(`${fieldName(k)} (${Array.isArray(old) ? `${old.length} → ` : ""}${v.length}): ${clip(show(k, v, today), 220)}`);
    else if (["summary", "description", "why"].includes(k)) out.push(`${fieldName(k)}: ${clip(show(k, v, today), 220)}`);
    else if (k === "title") out.push(`title: ${q(show(k, old, today), 300)} → ${q(show(k, v, today), 300)}`);
    else out.push(`${fieldName(k)}: ${clip(show(k, old, today), 70)} → ${clip(show(k, v, today), 70)}`);
  }
  return out;
}

/** JSON of `make(shown, more)` with as many items as fit in about 12k characters (at least one), so reads stay small. */
function fit<T>(items: T[], make: (shown: T[], more: number) => unknown, max = 12_000): string {
  const all = json(make(items, 0));
  if (all.length <= max) return all;
  let lo = Math.min(1, items.length), hi = items.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (json(make(items.slice(0, mid), items.length - mid)).length <= max) lo = mid;
    else hi = mid - 1;
  }
  return json(make(items.slice(0, lo), items.length - lo));
}

/** A task in full for the model, without bookkeeping fields. */
const detailOf = (t: RoadmapTask) => ({
  id: t.id, category: t.category, title: t.title, status: t.status, priority: t.priority, impact: t.impact, effort: t.effort, due_date: t.due_date, source: t.source,
  description: t.description || undefined, why: t.why || undefined,
  evidence: t.evidence?.length ? t.evidence.map((e) => `${e.source} · ${e.label}: ${e.value}`) : undefined,
  steps: t.steps.length ? t.steps : undefined, urls: t.urls.length ? t.urls : undefined, keywords: t.keywords.length ? t.keywords : undefined,
  subtasks: t.subtasks.length ? t.subtasks : undefined, completed_at: t.completed_at ?? undefined,
});

const GENERATED_BY: Record<string, string> = { ai: "AI generated", schedule: "prepared automatically", nova: "by Nova", manual: "written by hand" };
const NOT_A_DIFF = new Set(["id", "client_id", "month_id", "created_at", "updated_at", "created_by", "updated_by", "sort", "dedupe_key", "completed_at", "evidence", "generated_at", "generated_by", "model", "sources", "cost_usd"]);

/** "field: old → new" for history entries that keep the values before and after. */
function diffOf(c: ChangeEntry, today: string): string[] | undefined {
  if (!["task.update", "task.complete", "task.move", "task.checklist", "month.update"].includes(c.action)) return undefined;
  const b = c.before as Record<string, unknown> | null, a = c.after as Record<string, unknown> | null;
  if (!b || !a || typeof b !== "object" || typeof a !== "object") return undefined;
  const out = Object.keys(a).filter((k) => !NOT_A_DIFF.has(k) && json(b[k] ?? null) !== json(a[k] ?? null)).slice(0, 6)
    .map((k) => `${fieldName(k)}: ${clip(show(k, b[k], today), 80)} → ${clip(show(k, a[k], today), 80)}`);
  return out.length ? out : undefined;
}

/** Display names of the people in these history entries. */
async function peopleNames(ctx: Pick<NovaCtx, "admin">, rows: ChangeEntry[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => (r.user_id ? [r.user_id] : [])))];
  if (!ids.length) return new Map();
  const { data } = await ctx.admin.from("profiles").select("user_id, full_name").in("user_id", ids);
  return new Map((data ?? []).filter((p) => p.full_name).map((p) => [p.user_id as string, String(p.full_name)]));
}
const who = (c: ChangeEntry, names: Map<string, string>) => {
  const name = c.user_id ? names.get(c.user_id) : undefined;
  if (c.actor === "schedule") return "automatic schedule";
  if (c.actor === "nova") return name ? `Nova (confirmed by ${name})` : "Nova";
  return name ?? "a team member";
};
const stamp = (iso: string, timezone: string) => {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso)); } catch { return iso.slice(0, 16).replace("T", " "); }
};

/* ------------------------------------------------------------------ tools */

export const tools: NovaTool[] = [
  read({
    name: "get_roadmap",
    description: "One month of the SEO roadmap: summary, objectives, priorities, expected outcomes, progress and tasks (ids, titles, status). Also lists which months exist.",
    schema: z.object({ month: monthArg }),
    async run(ctx, a) {
      const month = needMonth(a.month, ctx.client.timezone);
      const [m, months] = await Promise.all([getMonth(ctx.admin, ctx.client.id, month), listMonths(ctx.admin, ctx.client.id)]);
      const tasks = m ? await getTasks(ctx.admin, ctx.client.id, m.id) : [];
      const head = { month: monthLabel(month), exists: Boolean(m), months_with_roadmaps: months.map((x) => x.month.slice(0, 7)),
        summary: m?.summary, focus: m?.focus, objectives: m?.objectives, priorities: m?.priorities, expected_outcomes: m?.expected_outcomes, progress: progress(tasks) };
      return fit(tasks.map(compact), (shown, more) => ({ ...head, tasks: shown, ...(more ? { more_tasks: more, note: "Not every task fits here: use get_roadmap_tasks or search_roadmap_tasks with a category or status." } : {}) }));
    },
    summary: (a) => `Read the ${a.month === "current" ? "current" : a.month} roadmap`,
  }),
  read({
    name: "get_roadmap_tasks",
    description: "Full details of roadmap tasks (description, why, evidence, steps, URLs, keywords, checklist items with ids). Filter by month, category, status, or one task id.",
    schema: z.object({ month: monthArg, category: z.enum(CATEGORY_KEYS).optional(), status: z.enum(STATUSES).optional(), task_id: z.string().optional() }),
    async run(ctx, a) {
      if (a.task_id) return json([detailOf(await taskOf(ctx, a.task_id))]);
      const m = await getMonth(ctx.admin, ctx.client.id, needMonth(a.month, ctx.client.timezone));
      let tasks = m ? await getTasks(ctx.admin, ctx.client.id, m.id) : [];
      if (a.category) tasks = tasks.filter((t) => t.category === a.category);
      if (a.status) tasks = tasks.filter((t) => t.status === a.status);
      return fit(tasks.slice(0, 40).map(detailOf), (shown, more) => (more ? { tasks: shown, more, note: "Too long to show every task in full: ask again with a category, a status or one task_id." } : shown));
    },
    summary: (a) => (a.task_id ? "Read a task" : "Read roadmap tasks"),
  }),
  read({
    name: "get_roadmap_progress",
    description: "Progress of a month: done/open per category, overdue tasks, high-priority open tasks and the latest changes (who changed what).",
    schema: z.object({ month: monthArg }),
    async run(ctx, a) {
      const month = needMonth(a.month, ctx.client.timezone);
      const m = await getMonth(ctx.admin, ctx.client.id, month);
      if (!m) return json({ month: monthLabel(month), exists: false });
      const tasks = await getTasks(ctx.admin, ctx.client.id, m.id);
      const today = todayIn(ctx.client.timezone);
      const { data: changes } = await ctx.admin.from("roadmap_changes").select("created_at, actor, action, summary").eq("client_id", ctx.client.id).eq("month_id", m.id).order("created_at", { ascending: false }).limit(12);
      const overdue = tasks.filter((t) => isOpen(t) && t.due_date && t.due_date < today).map(compact);
      return fit(overdue, (shown, more) => ({
        month: monthLabel(month), overall: progress(tasks),
        by_category: CATEGORIES.map((c) => ({ category: c.label, ...progress(tasks.filter((t) => t.category === c.key)) })).filter((x) => x.total),
        overdue: shown, ...(more ? { more_overdue: more } : {}),
        high_priority_open: tasks.filter((t) => isOpen(t) && t.priority === "high").slice(0, 15).map(compact),
        recent_changes: changes ?? [],
      }));
    },
    summary: () => "Checked roadmap progress",
  }),
  read({
    name: "list_roadmap_months",
    description: "Every month that has a roadmap (newest first) with its progress: done, open, skipped, overdue and high-priority open tasks, plus who wrote the strategy and its focus.",
    schema: z.object({}),
    async run(ctx) {
      const today = todayIn(ctx.client.timezone), current = monthOf(today);
      const [months, tasks] = await Promise.all([
        ctx.admin.from("roadmap_months").select("id, month, focus, generated_by, generated_at").eq("client_id", ctx.client.id).order("month", { ascending: false }).limit(120),
        taskStats(ctx.admin, ctx.client.id),
      ]);
      if (months.error) throw new ToolError("Could not read the roadmap months.");
      type Row = (typeof tasks)[number];
      const byMonth = new Map<string, Row[]>();
      for (const t of tasks) byMonth.set(t.month_id, [...(byMonth.get(t.month_id) ?? []), t]);
      const rows = (months.data ?? []).map((m) => {
        const ts = byMonth.get(m.id) ?? [], n = (f: (t: Row) => boolean) => ts.filter(f).length || undefined;
        return {
          month: ym(m.month), ...(m.month === current ? { current: true } : {}), ...progress(ts),
          skipped: n((t) => t.status === "skipped"), overdue: n((t) => isOpen(t) && Boolean(t.due_date) && t.due_date! < today),
          high_priority_open: n((t) => isOpen(t) && t.priority === "high"),
          strategy: m.generated_at ? `${GENERATED_BY[m.generated_by] ?? m.generated_by}, ${String(m.generated_at).slice(0, 10)}` : undefined,
          focus: m.focus ? clip(m.focus, 160) : undefined,
        };
      });
      return fit(rows, (shown, more) => ({ today, current_month: ym(current), months: shown, ...(more ? { more } : {}) }));
    },
    summary: () => "Listed the roadmap months",
  }),
  read({
    name: "search_roadmap_tasks",
    description: "Find tasks across all months by words (title, description, why, keywords, pages, checklist), category, status (\"open\" = to do or in progress), priority, source, overdue or a month range. Gives the task ids the bulk tools need.",
    schema: z.object({
      text: z.string().trim().max(200).optional(),
      category: z.enum(CATEGORY_KEYS).optional(),
      status: z.enum(["open", ...STATUSES]).optional(),
      priority: z.enum(LEVELS).optional(),
      source: z.enum(["ai", "manual", "nova"]).optional(),
      overdue: z.boolean().optional().describe("only open tasks past their due date"),
      from_month: z.string().trim().optional().describe("YYYY-MM, current, next or previous"),
      to_month: z.string().trim().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async run(ctx, a) {
      const tz = ctx.client.timezone, today = todayIn(tz);
      const from = a.from_month ? needMonth(a.from_month, tz) : null, to = a.to_month ? needMonth(a.to_month, tz) : null;
      const index = await monthIndex(ctx.admin, ctx.client.id);
      const monthIds = from || to ? [...index].filter(([, m]) => (!from || m >= from) && (!to || m <= to)).map(([id]) => id) : undefined;
      const OPEN: string[] = ["todo", "in_progress"];
      let statuses = a.status === "open" ? OPEN : a.status ? [a.status] : undefined;
      if (a.overdue) statuses = (statuses ?? OPEN).filter((s) => OPEN.includes(s));
      if (statuses && !statuses.length) return json({ found: 0, tasks: [], note: "Overdue tasks are open (to do or in progress) and past their due date." });
      const found = await searchTasks(ctx.admin, ctx.client.id, { text: a.text, category: a.category, statuses, priority: a.priority, source: a.source, monthIds, dueBefore: a.overdue ? today : undefined });
      const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const monthOfTask = (t: { month_id: string }) => index.get(t.month_id) ?? "";
      found.sort(a.overdue ? (x, y) => (x.due_date ?? "").localeCompare(y.due_date ?? "")
        : (x, y) => monthOfTask(y).localeCompare(monthOfTask(x)) || RANK[x.priority] - RANK[y.priority] || (x.due_date ?? "9999").localeCompare(y.due_date ?? "9999"));
      const rows = found.slice(0, a.limit).map((t) => ({ ...compact(t), month: ym(monthOfTask(t)), ...(isOpen(t) && t.due_date && t.due_date < today ? { overdue: true } : {}) }));
      return fit(rows, (shown) => ({ found: found.length, tasks: shown, ...(found.length > shown.length ? { not_shown: found.length - shown.length, note: "Narrow the search (month, category, status) to see the rest." } : {}) }));
    },
    summary: (a) => (a.text ? `Searched roadmap tasks for "${clip(a.text, 40)}"` : "Searched roadmap tasks"),
  }),
  read({
    name: "get_roadmap_history",
    description: "The roadmap's change history, newest first: who (a person, Nova or the automatic schedule) added, changed, completed, moved or deleted what, with old → new values. Filter by month, task, actor, action or the last N days.",
    schema: z.object({
      month: z.string().trim().optional().describe("changes to this month's roadmap"),
      task_id: z.string().optional(),
      actor: z.enum(["user", "nova", "schedule"]).optional(),
      action: z.string().regex(/^(task|month)(\.[a-z]+)?$/).optional().describe('"task", "month", or one of task.add, task.update, task.complete, task.checklist, task.move, task.copy, task.delete, month.create, month.generate, month.update, month.delete'),
      days: z.number().int().min(1).max(730).optional().describe("only the last N days"),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    async run(ctx, a) {
      const tz = ctx.client.timezone, today = todayIn(tz);
      const taskId = a.task_id?.trim().toLowerCase();
      if (taskId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(taskId)) throw new ToolError("task_id must be a task id from the roadmap.");
      let monthId: string | undefined, summaryHas: string | undefined, note: string | undefined;
      if (a.month) {
        const month = needMonth(a.month, tz), m = await getMonth(ctx.admin, ctx.client.id, month);
        // a deleted month has no row any more: find the entries that name it (its creation, strategy, deletion, moves)
        if (m) monthId = m.id;
        else { summaryHas = monthLabel(month); note = `There's no ${monthLabel(month)} roadmap now; these entries mention it.`; }
      }
      const { rows, total } = await listChanges(ctx.admin, ctx.client.id, { monthId, taskId, actor: a.actor, action: a.action, summaryHas, limit: a.limit,
        since: a.days ? new Date(Date.now() - a.days * 86_400_000).toISOString() : undefined });
      const [index, names] = await Promise.all([monthIndex(ctx.admin, ctx.client.id), peopleNames(ctx, rows)]);
      const out = rows.map((c) => ({
        at: stamp(c.created_at, tz), by: who(c, names), action: c.action, summary: c.summary,
        month: c.month_id && index.has(c.month_id) ? ym(index.get(c.month_id)!) : undefined, task_id: c.task_id ?? undefined, changes: diffOf(c, today),
      }));
      return fit(out, (shown) => ({ total, changes: shown, ...(total > shown.length ? { not_shown: total - shown.length } : {}), ...(note ? { note } : {}) }));
    },
    summary: () => "Read the roadmap history",
  }),

  write({
    name: "generate_monthly_strategy",
    description: "Generate a month's strategy and tasks from the client's data with AI (takes 1-2 minutes, about $0.30). If the month has tasks, open AI tasks nobody started are replaced; completed, started, manual and Nova tasks are kept. focus steers it, e.g. \"backlinks and local SEO\".",
    schema: z.object({ month: monthArg, focus: z.string().trim().max(400).optional() }),
    async prepare(ctx, a) {
      const month = needMonth(a.month, ctx.client.timezone);
      const m = await getMonth(ctx.admin, ctx.client.id, month);
      const has = m ? (await getTasks(ctx.admin, ctx.client.id, m.id)).length : 0;
      return {
        title: `${has ? "Refresh" : "Generate"} the ${monthLabel(month)} strategy${a.focus ? ` (focus: ${a.focus})` : ""}`,
        detail: has ? `Open AI tasks nobody has started are replaced with new ones from the latest data. Completed, started, manually added and Nova tasks are kept. ${has} tasks in the month now. Takes 1-2 minutes.` : "Builds the month's summary, objectives and tasks from the client's data. Takes 1-2 minutes.",
        input: { month: month.slice(0, 7), focus: a.focus },
        expectSeconds: 150,
      };
    },
    async execute(x, a) {
      const month = needMonth(a.month, x.client.timezone);
      const r = await generateMonth(x.admin, x.client.id, x.client.timezone, month, novaActor(x.userId), { focus: a.focus ?? null });
      return r.ok ? { ok: true, message: `${monthLabel(month)} strategy ready: ${r.added} new tasks${r.kept ? `, ${r.kept} kept` : ""}${r.removed ? `, ${r.removed} open AI tasks replaced` : ""}.`, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "create_roadmap_month",
    description: "Create a month's roadmap without AI: empty, or with a summary, focus, objectives, priorities and expected outcomes you write. Fails when the month exists (then use update_monthly_strategy).",
    schema: monthPatch.extend({ month: monthReq }),
    async prepare(ctx, a) {
      const { month: m, ...patch } = a;
      const month = needMonth(m, ctx.client.timezone), label = monthLabel(month);
      const row = await getMonth(ctx.admin, ctx.client.id, month);
      if (row) return { error: `The ${label} roadmap already exists (${plural((await getTasks(ctx.admin, ctx.client.id, row.id)).length, "task")}). Change it with update_monthly_strategy or add tasks to it.` };
      const lines = describePatch(patch);
      return {
        title: `Create the ${label} roadmap`,
        detail: lines.length ? [bullets(lines), writesStrategy(patch) ? "Shown as Nova's strategy; the automatic monthly run won't replace it." : ""].filter(Boolean).join("\n") : "An empty month: no strategy or tasks yet.",
        input: { ...a, month: ym(month) },
      };
    },
    async execute(x, a) {
      const { month, ...patch } = a;
      const r = await createMonth(x.admin, x.client.id, needMonth(month, x.client.timezone), patch, novaActor(x.userId));
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "update_monthly_strategy",
    description: "Change a month's summary, focus, objectives, priorities or expected outcomes (lists replace the existing ones).",
    schema: monthPatch.extend({ month: monthArg }),
    async prepare(ctx, a) {
      const { month: m, ...patch } = a;
      const month = needMonth(m, ctx.client.timezone), label = monthLabel(month);
      if (!describePatch(patch).length) return { error: "Nothing to change: give at least one field." };
      const row = await getMonth(ctx.admin, ctx.client.id, month);
      const lines = row ? changeLines(row as unknown as Record<string, unknown>, patch, todayIn(ctx.client.timezone)) : describePatch(patch);
      if (!lines.length) return { error: `Nothing would change: the ${label} strategy already says that.` };
      return { title: `Update the ${label} strategy`, detail: [bullets(lines), row ? "" : `Creates the ${label} roadmap month.`].filter(Boolean).join("\n"), input: { ...a, month: ym(month) } };
    },
    async execute(x, a) {
      const { month, ...patch } = a;
      const r = await updateMonth(x.admin, x.client.id, needMonth(month, x.client.timezone), patch, novaActor(x.userId), { written: true });
      return r.ok ? { ok: true, message: `Updated the ${monthLabel(r.value.month)} strategy.`, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "delete_roadmap_month",
    description: "Delete a month's whole roadmap: its strategy and every task in it. The change history is kept.",
    schema: z.object({ month: monthReq, reason: z.string().max(300).optional(), task_count: z.number().int().min(0).optional().describe("leave out (set when prepared)") }),
    async prepare(ctx, a) {
      const tz = ctx.client.timezone, today = todayIn(tz);
      const month = needMonth(a.month, tz), label = monthLabel(month);
      const row = await getMonth(ctx.admin, ctx.client.id, month);
      if (!row) return { error: `There's no ${label} roadmap to delete.` };
      const tasks = await getTasks(ctx.admin, ctx.client.id, row.id);
      const counts = STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${statusText(s)}`).join(", ");
      const items = tasks.reduce((n, t) => n + t.subtasks.length, 0);
      return {
        title: tasks.length ? `Delete the ${label} roadmap and its ${plural(tasks.length, "task")}` : `Delete the empty ${label} roadmap`,
        detail: [
          tasks.length ? `Removes the month's strategy and all ${plural(tasks.length, "task")} (${counts}${items ? `; ${plural(items, "checklist item")}` : ""}):` : "Removes the month's strategy. It has no tasks.",
          tasks.length ? bullets(tasks.map((t) => `${t.title} (${statusText(t.status)})`)) : "",
          a.reason ? `Reason: ${a.reason}` : "",
          month === monthOf(today) && Number(today.slice(8, 10)) <= 7 ? "It's the first week of the month, so the automatic monthly strategy may build this month again." : "",
          "The change history keeps a record. This can't be undone.",
        ].filter(Boolean).join("\n"),
        input: { month: ym(month), reason: a.reason, task_count: tasks.length },
      };
    },
    async execute(x, a) {
      const r = await deleteMonth(x.admin, x.client.id, needMonth(a.month, x.client.timezone), novaActor(x.userId), { maxTasks: a.task_count, reason: a.reason });
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),

  write({
    name: "add_roadmap_task",
    description: `Add one task to a month. Categories: ${CATEGORIES.map((c) => `${c.key} = ${c.label}`).join(", ")}. Ground "why" in the client's data; give concrete steps; due_date YYYY-MM-DD. For several tasks use bulk_add_roadmap_tasks.`,
    schema: taskInput.extend({ month: monthArg }),
    async prepare(ctx, a) {
      const month = needMonth(a.month, ctx.client.timezone), label = monthLabel(month);
      const row = await getMonth(ctx.admin, ctx.client.id, month);
      if (row) {
        const { data: dup } = await ctx.admin.from("roadmap_tasks").select("title").eq("client_id", ctx.client.id).eq("month_id", row.id).eq("dedupe_key", dedupeKey(a.category, a.title)).maybeSingle();
        if (dup) return { error: `A task like this is already in the ${label} roadmap: "${dup.title}". Update that task instead.` };
      }
      return {
        title: `Add "${a.title}" to the ${label} roadmap`,
        detail: [`${categoryLabel(a.category)}${a.priority ? ` · ${a.priority} priority` : ""}${a.due_date ? ` · due ${a.due_date}` : ""}`, a.why, a.steps?.length ? bullets(a.steps, 6) : "", row ? "" : `Creates the ${label} roadmap month.`].filter(Boolean).join("\n"),
        input: { ...a, month: ym(month) },
      };
    },
    async execute(x, a) {
      const { month, ...input } = a;
      const r = await addTask(x.admin, x.client.id, needMonth(month, x.client.timezone), input, novaActor(x.userId), { source: "nova" });
      return r.ok ? { ok: true, message: `Added "${r.value.title}" to ${categoryLabel(r.value.category)}.`, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "bulk_add_roadmap_tasks",
    description: "Add several tasks (up to 15) to one month with a single confirmation; same fields as add_roadmap_task. Tasks already in the month are skipped.",
    schema: z.object({ month: monthArg, tasks: z.array(taskInput).min(1).max(15) }),
    async prepare(ctx, a) {
      const tz = ctx.client.timezone, today = todayIn(tz), month = needMonth(a.month, tz), label = monthLabel(month);
      const row = await getMonth(ctx.admin, ctx.client.id, month);
      const plan = planAdd(a.tasks, row ? await getTasks(ctx.admin, ctx.client.id, row.id) : []);
      if (!plan.add.length) return { error: `Nothing to add, these are already in the ${label} roadmap: ${plan.skipped.join("; ")}` };
      return {
        title: `Add ${plural(plan.add.length, "task")} to the ${label} roadmap`,
        detail: [
          bullets(plan.add.map((t) => `${t.title} (${categoryLabel(t.category)} · ${t.priority} priority${t.due_date ? ` · due ${day(t.due_date, today)}` : ""}${t.subtasks.length ? ` · ${plural(t.subtasks.length, "checklist item")}` : ""})`), 15),
          row ? "" : `Creates the ${label} roadmap month.`,
          plan.skipped.length ? `Skipped: ${plan.skipped.join("; ")}` : "",
        ].filter(Boolean).join("\n"),
        input: { month: ym(month), tasks: plan.add },
      };
    },
    async execute(x, a) {
      const r = await addTasks(x.admin, x.client.id, needMonth(a.month, x.client.timezone), a.tasks, novaActor(x.userId), { source: "nova" });
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "update_roadmap_task",
    description: "Change a task: title, description, why, steps, URLs, keywords, category, priority, impact, effort, status, due date; replace the checklist (subtasks) or append items (add_subtasks).",
    schema: taskPatch.extend({ task_id: z.string() }),
    async prepare(ctx, a) {
      const { task_id, ...patch } = a;
      const t = await taskOf(ctx, task_id);
      if (!describePatch(patch).length) return { error: "Nothing to change: give at least one field." };
      const lines = changeLines(t as unknown as Record<string, unknown>, patch, todayIn(ctx.client.timezone));
      if (!lines.length) return { error: `Nothing would change: "${t.title}" already has these values.` };
      if (patch.title !== undefined || patch.category !== undefined) {
        const key = dedupeKey(patch.category ?? t.category, patch.title ?? t.title);
        if (key !== keyOf(t)) {
          const { data: dup } = await ctx.admin.from("roadmap_tasks").select("title").eq("client_id", ctx.client.id).eq("month_id", t.month_id).eq("dedupe_key", key).neq("id", t.id).maybeSingle();
          if (dup) return { error: `Another task this month already has that title: "${dup.title}".` };
        }
      }
      return { title: `Update "${t.title}"`, detail: bullets(lines) };
    },
    async execute(x, a) {
      const { task_id, ...patch } = a;
      const r = await updateTask(x.admin, x.client.id, task_id, patch, novaActor(x.userId));
      return r.ok ? { ok: true, message: `Updated "${r.value.title}".`, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "bulk_update_roadmap_tasks",
    description: "Make the same change to several tasks with one confirmation: status, priority, impact, effort, category, due date, or shift their due dates by N days.",
    schema: bulkPatch.extend({ task_ids: taskIds }),
    async prepare(ctx, a) {
      const { task_ids, ...patch } = a;
      const today = todayIn(ctx.client.timezone);
      if (patch.due_date !== undefined && patch.shift_due_days !== undefined) return { error: "Give due_date or shift_due_days, not both." };
      if (!Object.values(patch).some((v) => v !== undefined && v !== 0)) return { error: "Nothing to change: give at least one field." };
      const tasks = await tasksOf(ctx, task_ids);
      const plan = planUpdate(tasks, patch, patch.category ? await taskKeys(ctx.admin, ctx.client.id, tasks.map((t) => t.month_id)) : []);
      const go = plan.filter((p) => !p.skip && p.changes.length), skipped = plan.filter((p) => p.skip);
      const same = plan.length - go.length - skipped.length;
      if (!go.length) return { error: skipped.length ? `Nothing can change: ${skipped.map((p) => `${q(p.task.title, 60)} (${p.skip})`).join("; ")}` : `Nothing would change: ${tasks.length === 1 ? "the task already has" : "these tasks already have"} these values${patch.shift_due_days ? " or no due date" : ""}.` };
      const shift = patch.shift_due_days ? `due dates ${patch.shift_due_days > 0 ? "+" : ""}${plural(patch.shift_due_days, "day")}` : "";
      const what = [patch.status && `status → ${statusText(patch.status)}`, patch.priority && `priority → ${patch.priority}`, patch.impact && `impact → ${patch.impact}`,
        patch.effort && `effort → ${patch.effort}`, patch.category && `category → ${categoryLabel(patch.category)}`, patch.due_date !== undefined && `due date → ${day(patch.due_date, today)}`, shift].filter(Boolean).join(", ");
      return {
        title: `Update ${plural(go.length, "task")}: ${what}`,
        detail: [
          bullets(go.map((p) => `${p.task.title}: ${p.changes.map(([k, from, to]) => `${fieldName(k)} ${show(k, from, today)} → ${show(k, to, today)}`).join(" · ")}`)),
          same ? `${plural(same, "other task")} already ${same === 1 ? "has" : "have"} these values${patch.shift_due_days ? " or no due date" : ""}.` : "",
          skipped.length ? `Skipped: ${skipped.map((p) => `${q(p.task.title, 60)} (${p.skip})`).join("; ")}` : "",
        ].filter(Boolean).join("\n"),
        input: { ...patch, task_ids: go.map((p) => p.task.id) },
      };
    },
    async execute(x, a) {
      const { task_ids, ...patch } = a;
      const r = await updateTasks(x.admin, x.client.id, task_ids, patch, novaActor(x.userId));
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "mark_task_completed",
    description: "Mark a task done (completed: true) or reopen it (completed: false). Viewers may do this too.",
    roles: ["owner", "admin", "viewer"],
    schema: z.object({ task_id: z.string(), completed: z.boolean().default(true) }),
    async prepare(ctx, a) {
      const t = await taskOf(ctx, a.task_id);
      if (a.completed && t.status === "done") return { error: `"${t.title}" is already done.` };
      if (!a.completed && t.status === "todo") return { error: `"${t.title}" is already open (to do).` };
      return { title: `${a.completed ? "Mark done" : "Reopen"}: "${t.title}"`, detail: `${categoryLabel(t.category)} · now ${statusText(t.status)}` };
    },
    async execute(x, a) {
      const r = await updateTask(x.admin, x.client.id, a.task_id, { status: a.completed ? "done" : "todo" }, novaActor(x.userId));
      return r.ok ? { ok: true, message: `${a.completed ? "Completed" : "Reopened"} "${r.value.title}".`, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "move_roadmap_tasks",
    description: "Move or copy tasks to another month: the given task_ids, or every open task of from_month (carry over unfinished work, e.g. November to December). Tasks already in the target month are skipped.",
    schema: z.object({
      to_month: monthReq,
      task_ids: z.array(z.string()).max(60).optional(),
      from_month: z.string().trim().optional().describe("instead of task_ids: every to do and in progress task of this month"),
      copy: z.boolean().default(false).describe("copy instead of move: the originals stay; copies start as to do with checklists unticked"),
      due_dates: z.enum(["shift", "keep", "clear"]).default("shift").describe("shift (default): the same day of the month in the target month"),
    }),
    async prepare(ctx, a) {
      const tz = ctx.client.timezone, today = todayIn(tz);
      const to = needMonth(a.to_month, tz), toLabel = monthLabel(to);
      if (a.task_ids?.length && a.from_month) return { error: "Give task_ids or from_month, not both." };
      let tasks: RoadmapTask[], fromLabel: string | null = null;
      if (a.task_ids?.length) tasks = await tasksOf(ctx, a.task_ids);
      else if (a.from_month) {
        const from = needMonth(a.from_month, tz);
        fromLabel = monthLabel(from);
        if (from === to) return { error: "from_month and to_month are the same month." };
        const row = await getMonth(ctx.admin, ctx.client.id, from);
        if (!row) return { error: `There's no ${fromLabel} roadmap.` };
        tasks = (await getTasks(ctx.admin, ctx.client.id, row.id)).filter(isOpen);
        if (!tasks.length) return { error: `${fromLabel} has no open tasks: everything is done or skipped.` };
      } else return { error: "Give task_ids, or from_month to carry over its open tasks." };

      const [target, index] = await Promise.all([getMonth(ctx.admin, ctx.client.id, to), monthIndex(ctx.admin, ctx.client.id)]);
      const existing = target ? await getTasks(ctx.admin, ctx.client.id, target.id) : [];
      const plan = planMove(tasks, { id: target?.id ?? null, month: to, keys: existing.map(keyOf) }, { copy: a.copy, dueDates: a.due_dates, today });
      const go = plan.filter((p) => !p.skip), skipped = plan.filter((p) => p.skip).map((p) => `${q(p.task.title, 60)} (${p.skip})`);
      if (!go.length) return { error: `Nothing to ${a.copy ? "copy" : "move"}: ${skipped.join("; ")}` };
      const where = (t: RoadmapTask) => { const m = index.get(t.month_id); return m ? monthLabel(m, true) : "?"; };
      return {
        title: `${a.copy ? "Copy" : "Move"} ${plural(go.length, "task")}${fromLabel ? ` from ${fromLabel}` : ""} to ${toLabel}`,
        detail: [
          bullets(go.map(({ task: t, due }) => `${t.title}${fromLabel ? "" : ` (from ${where(t)})`}${due !== t.due_date ? ` · due ${day(t.due_date, today)} → ${day(due, today)}` : ""}`)),
          target ? "" : `Creates the ${toLabel} roadmap month.`,
          a.copy ? `The originals stay where they are; the copies start as to do with their checklists unticked.` : "Status, checklist and history move with each task.",
          go.some((p) => p.task.source === "ai") ? `AI tasks ${a.copy ? "are copied" : "move"} as Nova tasks, so refreshing the ${toLabel} strategy won't replace them.` : "",
          skipped.length ? `Skipped: ${skipped.slice(0, 8).join("; ")}${skipped.length > 8 ? `; and ${skipped.length - 8} more` : ""}` : "",
        ].filter(Boolean).join("\n"),
        input: { to_month: ym(to), task_ids: go.map((p) => p.task.id), copy: a.copy, due_dates: a.due_dates },
      };
    },
    async execute(x, a) {
      const tz = x.client.timezone;
      let ids = a.task_ids ?? [];
      if (!ids.length && a.from_month) {
        const row = await getMonth(x.admin, x.client.id, needMonth(a.from_month, tz));
        ids = row ? (await getTasks(x.admin, x.client.id, row.id)).filter(isOpen).map((t) => t.id) : [];
      }
      if (!ids.length) return { ok: false, message: "There are no tasks to move." };
      const r = await moveTasks(x.admin, x.client.id, ids, needMonth(a.to_month, tz), novaActor(x.userId), { copy: a.copy, dueDates: a.due_dates, today: todayIn(tz) });
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "edit_roadmap_checklist",
    description: "Edit one task's checklist: add items, rename, tick or untick, or remove items. Name items by their ids from get_roadmap_tasks (or their exact text).",
    schema: checklistOps.extend({ task_id: z.string() }),
    async prepare(ctx, a) {
      const { task_id, ...ops } = a;
      const t = await taskOf(ctx, task_id);
      const r = applyChecklist(t.subtasks, ops);
      if (r.errors.length) return { error: `${r.errors.join("; ")}. The checklist of "${t.title}" has: ${t.subtasks.map((s) => `${s.id} = ${q(s.text, 50)}${s.done ? " (done)" : ""}`).join(", ") || "no items"}.` };
      if (!r.lines.length) return { error: `Nothing would change: the checklist of "${t.title}" already looks like that.` };
      return { title: `Edit the checklist of "${t.title}"`, detail: [bullets(r.lines, 15), `Afterwards: ${r.next.filter((s) => s.done).length} of ${plural(r.next.length, "item")} done.`].join("\n") };
    },
    async execute(x, a) {
      const { task_id, ...ops } = a;
      const r = await editChecklist(x.admin, x.client.id, task_id, ops, novaActor(x.userId));
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "delete_roadmap_task",
    description: "Delete a task permanently.",
    schema: z.object({ task_id: z.string(), reason: z.string().max(300).optional() }),
    async prepare(ctx, a) {
      const t = await taskOf(ctx, a.task_id);
      const { data: m } = await ctx.admin.from("roadmap_months").select("month").eq("client_id", ctx.client.id).eq("id", t.month_id).maybeSingle();
      return { title: `Delete "${t.title}"`, detail: `${categoryLabel(t.category)}${m ? ` · ${monthLabel(m.month as string)}` : ""} · ${statusText(t.status)}${a.reason ? ` · ${a.reason.replace(/[.\s]+$/, "")}` : ""}. This can't be undone.` };
    },
    async execute(x, a) {
      const r = await deleteTask(x.admin, x.client.id, a.task_id, novaActor(x.userId));
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
  write({
    name: "bulk_delete_roadmap_tasks",
    description: "Delete several tasks permanently with one confirmation.",
    schema: z.object({ task_ids: taskIds, reason: z.string().max(300).optional() }),
    async prepare(ctx, a) {
      const [tasks, index] = await Promise.all([tasksOf(ctx, a.task_ids), monthIndex(ctx.admin, ctx.client.id)]);
      const months = [...new Set(tasks.map((t) => t.month_id))], one = months.length === 1 ? index.get(months[0]) : undefined;
      const done = tasks.filter((t) => t.status === "done").length;
      return {
        title: `Delete ${plural(tasks.length, "task")}${one ? ` from the ${monthLabel(one)} roadmap` : ""}`,
        detail: [
          bullets(tasks.map((t) => { const m = index.get(t.month_id); return `${t.title} (${one || !m ? "" : `${monthLabel(m, true)} · `}${categoryLabel(t.category)} · ${statusText(t.status)})`; })),
          done ? `${plural(done, "of them is", "of them are")} done.` : "",
          a.reason ? `Reason: ${a.reason}` : "",
          "This can't be undone.",
        ].filter(Boolean).join("\n"),
        input: { task_ids: tasks.map((t) => t.id), reason: a.reason },
      };
    },
    async execute(x, a) {
      const r = await deleteTasks(x.admin, x.client.id, a.task_ids, novaActor(x.userId), a.reason);
      return r.ok ? { ok: true, message: r.message, ...ROADMAP } : { ok: false, message: r.error };
    },
  }),
];
