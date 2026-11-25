import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { shiftDays } from "@/lib/analytics/range";
import { categoryLabel, CATEGORY_KEYS, dedupeKey, EFFORTS, lastDayOf, LEVELS, monthLabel, STATUSES, type RoadmapMonth, type RoadmapTask, type Subtask } from "./types";

/**
 * Roadmap reads and writes. Writes use the service-role client and are always scoped to one client id that the
 * caller has already authorised; every change is recorded in roadmap_changes with who (or what) made it.
 */
export type Actor = { kind: "user" | "nova" | "schedule"; userId: string | null };

const MONTH_COLS = "id, client_id, month, summary, objectives, priorities, expected_outcomes, focus, sources, generated_by, model, generated_at, updated_at";

export async function listMonths(db: SupabaseClient, clientId: string) {
  const { data, error } = await db.from("roadmap_months").select("id, month, generated_at").eq("client_id", clientId).order("month", { ascending: false }).limit(36);
  if (error) throw error;
  return (data ?? []) as { id: string; month: string; generated_at: string | null }[];
}

export async function getMonth(db: SupabaseClient, clientId: string, month: string): Promise<RoadmapMonth | null> {
  const { data, error } = await db.from("roadmap_months").select(MONTH_COLS).eq("client_id", clientId).eq("month", month).maybeSingle();
  if (error) throw error;
  return data as RoadmapMonth | null;
}

export async function getTasks(db: SupabaseClient, clientId: string, monthId: string): Promise<RoadmapTask[]> {
  const { data, error } = await db.from("roadmap_tasks").select("*").eq("client_id", clientId).eq("month_id", monthId).order("category").order("sort").order("created_at");
  if (error) throw error;
  return (data ?? []) as RoadmapTask[];
}

export type Change = { action: string; summary: string; monthId?: string | null; taskId?: string | null; before?: unknown; after?: unknown };
const changeRow = (clientId: string, actor: Actor, c: Change) => ({
  client_id: clientId, month_id: c.monthId ?? null, task_id: c.taskId ?? null, actor: actor.kind, user_id: actor.userId,
  action: c.action, summary: c.summary.slice(0, 500), before: c.before ?? null, after: c.after ?? null,
});

export async function logChange(admin: SupabaseClient, clientId: string, actor: Actor, c: Change) {
  await admin.from("roadmap_changes").insert(changeRow(clientId, actor, c));
}

/** Several history entries (one per task of a bulk change) in as few inserts as possible. */
export async function logChanges(admin: SupabaseClient, clientId: string, actor: Actor, cs: Change[]) {
  for (let i = 0; i < cs.length; i += 100) {
    const { error } = await admin.from("roadmap_changes").insert(cs.slice(i, i + 100).map((c) => changeRow(clientId, actor, c)));
    if (error) console.error("roadmap_changes", error.message);
  }
}

/** The month row, created empty when it doesn't exist yet. */
export async function ensureMonth(admin: SupabaseClient, clientId: string, month: string, actor: Actor): Promise<RoadmapMonth> {
  const found = await getMonth(admin, clientId, month);
  if (found) return found;
  const { data, error } = await admin.from("roadmap_months").upsert({ client_id: clientId, month, generated_by: actor.kind === "user" ? "manual" : actor.kind, created_by: actor.userId }, { onConflict: "client_id,month", ignoreDuplicates: false }).select(MONTH_COLS).single();
  if (error) throw error;
  return data as RoadmapMonth;
}

/* ------------------------------------------------------------------ validated inputs (used by forms and Nova) */
const str = (max: number) => z.string().trim().max(max);
const list = (max: number, len = 300) => z.array(str(len).min(1)).max(max);
export const taskInput = z.object({
  category: z.enum(CATEGORY_KEYS),
  title: str(300).min(3),
  description: str(4000).default(""),
  why: str(2000).default(""),
  steps: list(15, 600).default([]),
  urls: list(15, 500).default([]),
  keywords: list(20, 120).default([]),
  subtasks: list(20, 300).default([]),
  priority: z.enum(LEVELS).default("medium"),
  impact: z.enum(LEVELS).default("medium"),
  effort: z.enum(EFFORTS).default("medium"),
  due_date: z.iso.date().nullable().default(null),
});
export type TaskInput = z.input<typeof taskInput>;

export const taskPatch = z.object({
  category: z.enum(CATEGORY_KEYS).optional(),
  title: str(300).min(3).optional(),
  description: str(4000).optional(),
  why: str(2000).optional(),
  steps: list(15, 600).optional(),
  urls: list(15, 500).optional(),
  keywords: list(20, 120).optional(),
  priority: z.enum(LEVELS).optional(),
  impact: z.enum(LEVELS).optional(),
  effort: z.enum(EFFORTS).optional(),
  status: z.enum(STATUSES).optional(),
  due_date: z.iso.date().nullable().optional(),
  /** replaces the whole checklist (a checklist holds up to 30 items: add_subtasks appends up to that) */
  subtasks: z.array(z.object({ id: z.string().max(60).optional(), text: str(300).min(1), done: z.boolean().default(false) })).max(30).optional(),
  /** appended to the checklist */
  add_subtasks: list(20, 300).optional(),
});
export type TaskPatch = z.input<typeof taskPatch>;

const toSubtasks = (xs: string[]): Subtask[] => xs.map((text) => ({ id: randomUUID().slice(0, 8), text, done: false }));

export type WriteResult<T> = { ok: true; value: T; message: string } | { ok: false; error: string };

export async function addTask(admin: SupabaseClient, clientId: string, month: string, raw: TaskInput, actor: Actor, extra: { source?: RoadmapTask["source"]; evidence?: RoadmapTask["evidence"] } = {}): Promise<WriteResult<RoadmapTask>> {
  const p = taskInput.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid task: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}` };
  const t = p.data;
  const m = await ensureMonth(admin, clientId, month, actor);
  const key = dedupeKey(t.category, t.title);
  const { data: dup } = await admin.from("roadmap_tasks").select("id, title").eq("month_id", m.id).eq("dedupe_key", key).maybeSingle();
  if (dup) return { ok: false, error: `A task like this already exists this month: "${dup.title}".` };
  const { count } = await admin.from("roadmap_tasks").select("id", { count: "exact", head: true }).eq("month_id", m.id).eq("category", t.category);
  const row = {
    client_id: clientId, month_id: m.id, category: t.category, title: t.title, description: t.description, why: t.why,
    steps: t.steps, urls: t.urls, keywords: t.keywords, subtasks: toSubtasks(t.subtasks), priority: t.priority, impact: t.impact,
    effort: t.effort, due_date: t.due_date, source: extra.source ?? (actor.kind === "nova" ? "nova" : "manual"), evidence: extra.evidence ?? [],
    dedupe_key: key, sort: count ?? 0, created_by: actor.userId, updated_by: actor.userId,
  };
  const { data, error } = await admin.from("roadmap_tasks").insert(row).select("*").single();
  if (error) return { ok: false, error: error.code === "23505" ? "A task like this already exists this month." : "Could not save the task." };
  await logChange(admin, clientId, actor, { action: "task.add", summary: `Added "${t.title}"`, monthId: m.id, taskId: data.id, after: data });
  return { ok: true, value: data as RoadmapTask, message: `Added "${t.title}".` };
}

async function ownTask(admin: SupabaseClient, clientId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await admin.from("roadmap_tasks").select("*").eq("id", id).eq("client_id", clientId).maybeSingle();
  return data as RoadmapTask | null;
}

export async function updateTask(admin: SupabaseClient, clientId: string, id: string, raw: TaskPatch, actor: Actor): Promise<WriteResult<RoadmapTask>> {
  const p = taskPatch.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid change: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}` };
  const before = await ownTask(admin, clientId, id);
  if (!before) return { ok: false, error: "That task doesn't exist for this client." };
  const { add_subtasks, subtasks, ...rest } = p.data;
  const patch: Record<string, unknown> = { ...rest, updated_by: actor.userId };
  if (subtasks) patch.subtasks = subtasks.map((s) => ({ id: s.id || randomUUID().slice(0, 8), text: s.text, done: s.done }));
  if (add_subtasks?.length) patch.subtasks = [...((patch.subtasks as Subtask[] | undefined) ?? before.subtasks), ...toSubtasks(add_subtasks)].slice(0, 30);
  if (rest.status) patch.completed_at = rest.status === "done" ? (before.completed_at ?? new Date().toISOString()) : null;
  if (rest.title || rest.category) {
    patch.dedupe_key = dedupeKey(rest.category ?? before.category, rest.title ?? before.title);
    if (patch.dedupe_key !== dedupeKey(before.category, before.title)) {
      const { data: dup } = await admin.from("roadmap_tasks").select("id").eq("month_id", before.month_id).eq("dedupe_key", patch.dedupe_key as string).neq("id", id).maybeSingle();
      if (dup) return { ok: false, error: "Another task this month already has that title." };
    }
  }
  const { data, error } = await admin.from("roadmap_tasks").update(patch).eq("id", id).eq("client_id", clientId).select("*").single();
  if (error) return { ok: false, error: "Could not update the task." };
  const fields = Object.keys(p.data).join(", ");
  await logChange(admin, clientId, actor, { action: rest.status === "done" ? "task.complete" : "task.update", summary: `Updated "${data.title}" (${fields})`, monthId: before.month_id, taskId: id, before, after: data });
  return { ok: true, value: data as RoadmapTask, message: `Updated "${data.title}".` };
}

export async function toggleSubtask(admin: SupabaseClient, clientId: string, id: string, subId: string, done: boolean, actor: Actor): Promise<WriteResult<RoadmapTask>> {
  const t = await ownTask(admin, clientId, id);
  if (!t) return { ok: false, error: "That task doesn't exist for this client." };
  if (!t.subtasks.some((s) => s.id === subId)) return { ok: false, error: "That checklist item doesn't exist." };
  return updateTask(admin, clientId, id, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done } : s)) }, actor);
}

export async function deleteTask(admin: SupabaseClient, clientId: string, id: string, actor: Actor): Promise<WriteResult<{ title: string }>> {
  const before = await ownTask(admin, clientId, id);
  if (!before) return { ok: false, error: "That task doesn't exist for this client." };
  const { error } = await admin.from("roadmap_tasks").delete().eq("id", id).eq("client_id", clientId);
  if (error) return { ok: false, error: "Could not delete the task." };
  await logChange(admin, clientId, actor, { action: "task.delete", summary: `Deleted "${before.title}"`, monthId: before.month_id, taskId: id, before });
  return { ok: true, value: { title: before.title }, message: `Deleted "${before.title}".` };
}

export const monthPatch = z.object({
  summary: str(3000).optional(),
  focus: str(400).nullable().optional(),
  objectives: z.array(z.object({ title: str(200).min(1), detail: str(1000).default(""), metric: str(200).nullable().optional() })).max(8).optional(),
  priorities: list(10, 300).optional(),
  expected_outcomes: list(10, 300).optional(),
});
export type MonthPatch = z.input<typeof monthPatch>;

/**
 * `written`: the strategy was written on purpose (by Nova on request). A month that was never generated then gets a
 * generated_at, so the roadmap page shows it and the automatic monthly run doesn't overwrite it (a focus alone doesn't count).
 */
export async function updateMonth(admin: SupabaseClient, clientId: string, month: string, raw: MonthPatch, actor: Actor, opts: { written?: boolean } = {}): Promise<WriteResult<RoadmapMonth>> {
  const p = monthPatch.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid change: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}` };
  const before = await ensureMonth(admin, clientId, month, actor);
  const patch: Record<string, unknown> = { ...p.data };
  if (opts.written && !before.generated_at && writesStrategy(p.data)) patch.generated_at = new Date().toISOString();
  const { data, error } = await admin.from("roadmap_months").update(patch).eq("id", before.id).eq("client_id", clientId).select(MONTH_COLS).single();
  if (error) return { ok: false, error: "Could not update the month." };
  await logChange(admin, clientId, actor, { action: "month.update", summary: `Updated the ${month.slice(0, 7)} strategy (${Object.keys(p.data).join(", ")})`, monthId: before.id, before, after: data });
  return { ok: true, value: data as RoadmapMonth, message: "Strategy updated." };
}

export function progress(tasks: Pick<RoadmapTask, "status" | "category" | "priority">[]) {
  const counted = tasks.filter((t) => t.status !== "skipped");
  const done = counted.filter((t) => t.status === "done").length;
  return { total: counted.length, done, open: counted.length - done, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

/* ------------------------------------------------------------------ months, many tasks at once, checklists (Nova) */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MONTH = /^\d{4}-\d{2}-01$/;
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300);
const quote = (s: string) => `"${s.length > 80 ? `${s.slice(0, 79)}…` : s}"`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listed = (xs: string[], max = 5) => `${xs.slice(0, max).join("; ")}${xs.length > max ? `; and ${xs.length - max} more` : ""}`;

/** The duplicate key a task is stored with (same category and nearly the same title = the same task in a month). */
export const keyOf = (t: { category: string; title: string; dedupe_key?: string }) => t.dedupe_key || dedupeKey(t.category, t.title);

/** Every row of a query, 1000 at a time (the API returns at most 1000 rows per request); `run` must order the rows. */
async function pages<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Runs `fn` over the items, a few at a time. */
async function eachLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** This client's tasks with these ids, in the order given (unknown and malformed ids are left out). */
export async function getTasksByIds(db: SupabaseClient, clientId: string, ids: string[]): Promise<RoadmapTask[]> {
  const want = [...new Set(ids.map((s) => s.trim().toLowerCase()))].filter((s) => UUID.test(s));
  if (!want.length) return [];
  const { data, error } = await db.from("roadmap_tasks").select("*").eq("client_id", clientId).in("id", want);
  if (error) throw error;
  const byId = new Map(((data ?? []) as RoadmapTask[]).map((t) => [t.id, t]));
  return want.flatMap((id) => byId.get(id) ?? []);
}

/** month id → first day of that month, for every roadmap month of this client. */
export async function monthIndex(db: SupabaseClient, clientId: string): Promise<Map<string, string>> {
  const { data, error } = await db.from("roadmap_months").select("id, month").eq("client_id", clientId).limit(500);
  if (error) throw error;
  return new Map((data ?? []).map((m) => [m.id as string, m.month as string]));
}

/** id, month and duplicate key of every task in these months (to check new titles or categories against). */
export async function taskKeys(db: SupabaseClient, clientId: string, monthIds: string[]): Promise<{ id: string; month_id: string; dedupe_key: string }[]> {
  if (!monthIds.length) return [];
  const { data, error } = await db.from("roadmap_tasks").select("id, month_id, dedupe_key").eq("client_id", clientId).in("month_id", [...new Set(monthIds)]);
  if (error) throw error;
  return (data ?? []) as { id: string; month_id: string; dedupe_key: string }[];
}

/** Sort positions after the tasks already in each category. */
function sortAfter(existing: Pick<RoadmapTask, "category" | "sort">[]) {
  const next = new Map<string, number>();
  for (const t of existing) next.set(t.category, Math.max(next.get(t.category) ?? 0, (t.sort ?? 0) + 1));
  return (category: string) => { const s = next.get(category) ?? 0; next.set(category, s + 1); return s; };
}

/** Inserts task rows in one go; if that is refused (e.g. a duplicate added meanwhile), adds them one at a time. */
async function insertRows(admin: SupabaseClient, rows: Record<string, unknown>[]): Promise<{ inserted: RoadmapTask[]; failed: string[] }> {
  if (!rows.length) return { inserted: [], failed: [] };
  const { data, error } = await admin.from("roadmap_tasks").insert(rows).select("*");
  if (!error) return { inserted: (data ?? []) as RoadmapTask[], failed: [] };
  const inserted: RoadmapTask[] = [], failed: string[] = [];
  for (const r of rows) {
    const { data: one, error: e } = await admin.from("roadmap_tasks").insert(r).select("*").single();
    if (one) inserted.push(one as RoadmapTask);
    else failed.push(`${quote(String(r.title))} (${e?.code === "23505" ? "a task like this is already in the month" : "could not be saved"})`);
  }
  return { inserted, failed };
}

/** The change writes strategy content (a summary, objectives, priorities or expected outcomes), not only a focus. */
export const writesStrategy = (p: { summary?: string; objectives?: unknown[]; priorities?: unknown[]; expected_outcomes?: unknown[] }) =>
  Boolean(p.summary?.trim() || p.objectives?.length || p.priorities?.length || p.expected_outcomes?.length);

/** A new month: empty, or with a strategy written by hand (then it shows as written and the automatic monthly run leaves it alone). */
export async function createMonth(admin: SupabaseClient, clientId: string, month: string, raw: MonthPatch, actor: Actor): Promise<WriteResult<RoadmapMonth>> {
  if (!MONTH.test(month)) return { ok: false, error: "Invalid month." };
  const p = monthPatch.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid month: ${issues(p.error)}` };
  const label = monthLabel(month);
  if (await getMonth(admin, clientId, month)) return { ok: false, error: `The ${label} roadmap already exists.` };
  const { data, error } = await admin.from("roadmap_months").insert({
    client_id: clientId, month, ...p.data, generated_by: actor.kind === "user" ? "manual" : actor.kind, created_by: actor.userId,
    generated_at: writesStrategy(p.data) ? new Date().toISOString() : null,
  }).select(MONTH_COLS).single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? `The ${label} roadmap already exists.` : "Could not create the month." };
  const row = data as RoadmapMonth;
  await logChange(admin, clientId, actor, { action: "month.create", summary: `Created the ${label} roadmap`, monthId: row.id, after: row });
  return { ok: true, value: row, message: `Created the ${label} roadmap.` };
}

/** True while this month's strategy is being generated (the lock generate.ts holds). */
async function generating(admin: SupabaseClient, clientId: string, month: string) {
  const { data } = await admin.from("dfs_cache").select("fetched_at").eq("client_id", clientId).eq("endpoint", "roadmap_lock").eq("params_hash", `roadmap_lock:${month}`).maybeSingle();
  return Boolean(data && Date.now() - Date.parse(data.fetched_at as string) < 8 * 60_000);
}

/**
 * Deletes a month's roadmap and, through the foreign key, all of its tasks. The history keeps a copy of both.
 * `maxTasks`: refuse when the month has more tasks than the user saw when confirming.
 */
export async function deleteMonth(admin: SupabaseClient, clientId: string, month: string, actor: Actor, opts: { maxTasks?: number; reason?: string } = {}): Promise<WriteResult<{ tasks: number }>> {
  if (!MONTH.test(month)) return { ok: false, error: "Invalid month." };
  const label = monthLabel(month);
  const m = await getMonth(admin, clientId, month);
  if (!m) return { ok: false, error: `There's no ${label} roadmap (already deleted?).` };
  if (await generating(admin, clientId, month)) return { ok: false, error: `The ${label} strategy is being generated right now. Try again in a few minutes.` };
  const tasks = await getTasks(admin, clientId, m.id);
  if (opts.maxTasks !== undefined && tasks.length > opts.maxTasks) return { ok: false, error: `The ${label} roadmap changed since this was prepared: it now has ${count(tasks.length, "task")}. Ask Nova again.` };
  const { error } = await admin.from("roadmap_months").delete().eq("id", m.id).eq("client_id", clientId);
  if (error) return { ok: false, error: "Could not delete the month." };
  // no month_id: the month row is gone (an entry pointing at it would be refused)
  await logChange(admin, clientId, actor, { action: "month.delete", summary: `Deleted the ${label} roadmap and its ${count(tasks.length, "task")}${opts.reason ? ` (${opts.reason})` : ""}`, before: { month: m, tasks } });
  return { ok: true, value: { tasks: tasks.length }, message: `Deleted the ${label} roadmap${tasks.length ? ` and its ${count(tasks.length, "task")}` : ""}.` };
}

/** Which new tasks can be added to a month: tasks already in it (same category and nearly the same title) or listed twice are skipped. */
export function planAdd<T extends { category: string; title: string }>(tasks: T[], existing: { category: string; title: string; dedupe_key?: string }[]) {
  const inMonth = new Map(existing.map((t) => [keyOf(t), t.title]));
  const seen = new Set<string>();
  const add: T[] = [], skipped: string[] = [];
  for (const t of tasks) {
    const key = dedupeKey(t.category, t.title), dup = inMonth.get(key);
    if (dup !== undefined) skipped.push(`${quote(t.title)} (already in the month${dup.toLowerCase() === t.title.toLowerCase() ? "" : ` as ${quote(dup)}`})`);
    else if (seen.has(key)) skipped.push(`${quote(t.title)} (listed twice)`);
    else { seen.add(key); add.push(t); }
  }
  return { add, skipped };
}

/** Adds several tasks to one month (created when missing); duplicates are skipped and reported. */
export async function addTasks(admin: SupabaseClient, clientId: string, month: string, raws: TaskInput[], actor: Actor, extra: { source?: RoadmapTask["source"] } = {}): Promise<WriteResult<{ added: RoadmapTask[]; skipped: string[] }>> {
  if (!MONTH.test(month)) return { ok: false, error: "Invalid month." };
  const p = z.array(taskInput).min(1).max(30).safeParse(raws);
  if (!p.success) return { ok: false, error: `Invalid tasks: ${issues(p.error)}` };
  const found = await getMonth(admin, clientId, month);
  const existing = found ? await getTasks(admin, clientId, found.id) : [];
  const plan = planAdd(p.data, existing);
  if (!plan.add.length) return { ok: false, error: `Nothing to add: ${listed(plan.skipped)}` };
  const m = found ?? (await ensureMonth(admin, clientId, month, actor));
  const sort = sortAfter(existing), source = extra.source ?? (actor.kind === "nova" ? "nova" : "manual");
  const r = await insertRows(admin, plan.add.map((t) => ({
    client_id: clientId, month_id: m.id, category: t.category, title: t.title, description: t.description, why: t.why,
    steps: t.steps, urls: t.urls, keywords: t.keywords, subtasks: toSubtasks(t.subtasks), priority: t.priority, impact: t.impact,
    effort: t.effort, due_date: t.due_date, source, evidence: [], dedupe_key: dedupeKey(t.category, t.title), sort: sort(t.category),
    created_by: actor.userId, updated_by: actor.userId,
  })));
  const skipped = [...plan.skipped, ...r.failed];
  if (!r.inserted.length) return { ok: false, error: `Nothing was added: ${listed(skipped)}` };
  await logChanges(admin, clientId, actor, r.inserted.map((t) => ({ action: "task.add", summary: `Added "${t.title}"`, monthId: m.id, taskId: t.id, after: t })));
  return { ok: true, value: { added: r.inserted, skipped }, message: `Added ${count(r.inserted.length, "task")} to ${monthLabel(month)}${skipped.length ? `. Skipped ${skipped.length}: ${listed(skipped)}` : ""}.` };
}

/** One change for many tasks at once. */
export const bulkPatch = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(LEVELS).optional(),
  impact: z.enum(LEVELS).optional(),
  effort: z.enum(EFFORTS).optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  due_date: z.iso.date().nullable().optional().describe("YYYY-MM-DD; null clears it"),
  shift_due_days: z.number().int().min(-366).max(366).optional().describe("instead of due_date: move each due date by N days (+7 = a week later)"),
});
export type BulkPatch = z.input<typeof bulkPatch>;
export type PlannedUpdate = { task: RoadmapTask; set: Record<string, unknown>; changes: [field: string, from: unknown, to: unknown][]; skip?: string };

/**
 * What a bulk change does to each task: the fields that really change, or why the task is skipped (its title would
 * clash with a task already in the new category that month). `keys`: taskKeys() of the months involved.
 */
export function planUpdate(tasks: RoadmapTask[], patch: z.output<typeof bulkPatch>, keys: { id: string; month_id: string; dedupe_key: string }[], now = new Date().toISOString()): PlannedUpdate[] {
  const used = new Map<string, Map<string, string>>(); // month id → duplicate key → task id
  const inMonth = (id: string) => used.get(id) ?? used.set(id, new Map()).get(id)!;
  for (const k of keys) inMonth(k.month_id).set(k.dedupe_key, k.id);
  return tasks.map((t) => {
    const set: Record<string, unknown> = {}, changes: PlannedUpdate["changes"] = [];
    const put = (field: keyof RoadmapTask, to: unknown) => { if (to !== undefined && to !== t[field]) { set[field] = to; changes.push([field, t[field], to]); } };
    if (patch.category && patch.category !== t.category) {
      const key = dedupeKey(patch.category, t.title), month = inMonth(t.month_id), holder = month.get(key);
      if (holder && holder !== t.id) return { task: t, set: {}, changes: [], skip: `a task with this title is already in ${categoryLabel(patch.category)}` };
      if (month.get(keyOf(t)) === t.id) month.delete(keyOf(t));
      month.set(key, t.id);
      put("category", patch.category);
      set.dedupe_key = key;
    }
    put("status", patch.status);
    put("priority", patch.priority);
    put("impact", patch.impact);
    put("effort", patch.effort);
    if (patch.due_date !== undefined) put("due_date", patch.due_date);
    else if (patch.shift_due_days && t.due_date) put("due_date", shiftDays(t.due_date, patch.shift_due_days));
    if ("status" in set) set.completed_at = set.status === "done" ? (t.completed_at ?? now) : null;
    return { task: t, set, changes };
  });
}

/** Applies one change to many tasks; tasks that can't take it are skipped and reported. */
export async function updateTasks(admin: SupabaseClient, clientId: string, ids: string[], raw: BulkPatch, actor: Actor): Promise<WriteResult<{ updated: RoadmapTask[]; skipped: string[]; unchanged: number }>> {
  const p = bulkPatch.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid change: ${issues(p.error)}` };
  if (p.data.due_date !== undefined && p.data.shift_due_days !== undefined) return { ok: false, error: "Give a due date or shift_due_days, not both." };
  const tasks = await getTasksByIds(admin, clientId, ids);
  if (!tasks.length) return { ok: false, error: "None of these tasks exist for this client any more." };
  const plan = planUpdate(tasks, p.data, p.data.category ? await taskKeys(admin, clientId, tasks.map((t) => t.month_id)) : []);
  const skipped = plan.flatMap((x) => (x.skip ? [`${quote(x.task.title)} (${x.skip})`] : []));
  const todo = plan.filter((x) => !x.skip && x.changes.length);
  const unchanged = plan.filter((x) => !x.skip && !x.changes.length).length;
  const results = await eachLimit(todo, 6, async (x) => {
    const { data, error } = await admin.from("roadmap_tasks").update({ ...x.set, updated_by: actor.userId }).eq("id", x.task.id).eq("client_id", clientId).select("*").single();
    if (!data) skipped.push(`${quote(x.task.title)} (${error?.code === "23505" ? "a task with this title is already in that category" : "could not be saved"})`);
    return { x, row: data as RoadmapTask | null };
  });
  const done = results.flatMap((r) => (r.row ? [{ x: r.x, row: r.row }] : []));
  await logChanges(admin, clientId, actor, done.map(({ x, row }) => ({
    action: x.set.status === "done" ? "task.complete" : "task.update", summary: `Updated "${row.title}" (${x.changes.map((c) => c[0]).join(", ")})`,
    monthId: row.month_id, taskId: row.id, before: Object.fromEntries(x.changes.map((c) => [c[0], c[1]])), after: Object.fromEntries(x.changes.map((c) => [c[0], c[2]])),
  })));
  if (!done.length) return skipped.length ? { ok: false, error: `Nothing was changed: ${listed(skipped)}` } : { ok: true, value: { updated: [], skipped, unchanged }, message: "Nothing to change: these tasks already look like that." };
  return { ok: true, value: { updated: done.map((d) => d.row), skipped, unchanged }, message: `Updated ${count(done.length, "task")}${unchanged ? ` (${unchanged} already like that)` : ""}${skipped.length ? `. Skipped ${skipped.length}: ${listed(skipped)}` : ""}.` };
}

/** Deletes several tasks; the history keeps a copy of each. */
export async function deleteTasks(admin: SupabaseClient, clientId: string, ids: string[], actor: Actor, reason?: string): Promise<WriteResult<{ deleted: RoadmapTask[] }>> {
  const tasks = await getTasksByIds(admin, clientId, ids);
  if (!tasks.length) return { ok: false, error: "None of these tasks exist for this client any more (already deleted?)." };
  const { data, error } = await admin.from("roadmap_tasks").delete().eq("client_id", clientId).in("id", tasks.map((t) => t.id)).select("id");
  if (error) return { ok: false, error: "Could not delete the tasks." };
  const gone = new Set((data ?? []).map((r) => r.id as string));
  const deleted = tasks.filter((t) => gone.has(t.id));
  await logChanges(admin, clientId, actor, deleted.map((t) => ({ action: "task.delete", summary: `Deleted "${t.title}"${reason ? ` (${reason})` : ""}`, monthId: t.month_id, taskId: t.id, before: t })));
  const missing = new Set(ids.map((s) => s.trim().toLowerCase())).size - deleted.length;
  return { ok: true, value: { deleted }, message: `Deleted ${count(deleted.length, "task")}${missing > 0 ? ` (${missing} no longer existed)` : ""}.` };
}

export type DueDates = "shift" | "keep" | "clear";

/**
 * A task's due date once it moves to `month`. shift: the same day of the month (its last day when the month is
 * shorter), never before `today` while the month is under way; keep: unchanged; clear: none.
 */
export function dueIn(due: string | null, month: string, mode: DueDates, today: string): string | null {
  if (!due || mode === "clear") return null;
  if (mode === "keep") return due;
  const last = lastDayOf(month);
  const d = `${month.slice(0, 8)}${String(Math.min(Number(due.slice(8, 10)), Number(last.slice(8, 10)))).padStart(2, "0")}`;
  return d < today && today <= last ? today : d;
}

export type PlannedMove = { task: RoadmapTask; due: string | null; skip?: string };

/** Which tasks can go to the target month (one like it may already be there) and their new due dates. */
export function planMove(tasks: RoadmapTask[], target: { id: string | null; month: string; keys: Iterable<string> }, mode: { copy: boolean; dueDates: DueDates; today: string }): PlannedMove[] {
  const keys = new Set(target.keys), label = monthLabel(target.month);
  return tasks.map((t) => {
    if (!mode.copy && t.month_id === target.id) return { task: t, due: t.due_date, skip: `already in ${label}` };
    if (keys.has(keyOf(t))) return { task: t, due: t.due_date, skip: `a task like this is already in ${label}` };
    keys.add(keyOf(t));
    return { task: t, due: dueIn(t.due_date, target.month, mode.dueDates, mode.today) };
  });
}

/**
 * Moves (or copies) tasks to another month, which is created when missing. A move keeps the task as it is (status,
 * checklist, history); a copy starts as to do with its checklist unticked. AI tasks become Nova tasks: the user chose
 * to keep them, so refreshing the target month's strategy must not replace them. Duplicates are skipped and reported.
 */
export async function moveTasks(admin: SupabaseClient, clientId: string, ids: string[], month: string, actor: Actor, mode: { copy: boolean; dueDates: DueDates; today: string }): Promise<WriteResult<{ moved: RoadmapTask[]; skipped: string[] }>> {
  if (!MONTH.test(month)) return { ok: false, error: "Invalid month." };
  const label = monthLabel(month), verb = mode.copy ? "copied" : "moved";
  const tasks = await getTasksByIds(admin, clientId, ids);
  if (!tasks.length) return { ok: false, error: "None of these tasks exist for this client any more." };
  const found = await getMonth(admin, clientId, month);
  const existing = found ? await getTasks(admin, clientId, found.id) : [];
  const plan = planMove(tasks, { id: found?.id ?? null, month, keys: existing.map(keyOf) }, mode);
  const skipped = plan.flatMap((p) => (p.skip ? [`${quote(p.task.title)} (${p.skip})`] : []));
  const go = plan.filter((p) => !p.skip);
  if (!go.length) return { ok: false, error: `Nothing was ${verb}: ${listed(skipped)}` };
  const target = found ?? (await ensureMonth(admin, clientId, month, actor));
  const index = await monthIndex(admin, clientId);
  const from = (monthId: string) => { const m = index.get(monthId); return m ? monthLabel(m) : "another month"; };
  const source = (t: RoadmapTask) => (t.source === "ai" ? "nova" : t.source);
  const sort = sortAfter(existing);
  const ready = go.map((p) => ({ ...p, sort: sort(p.task.category) }));
  let moved: RoadmapTask[];
  if (mode.copy) {
    const originals = new Map(ready.map((p) => [keyOf(p.task), p.task]));
    const r = await insertRows(admin, ready.map(({ task: t, due, sort: s }) => ({
      client_id: clientId, month_id: target.id, category: t.category, title: t.title, description: t.description, why: t.why, evidence: t.evidence,
      steps: t.steps, urls: t.urls, keywords: t.keywords, subtasks: t.subtasks.map((x) => ({ ...x, done: false })), priority: t.priority, impact: t.impact,
      effort: t.effort, status: "todo", due_date: due, source: source(t), dedupe_key: keyOf(t), sort: s, created_by: actor.userId, updated_by: actor.userId,
    })));
    moved = r.inserted;
    skipped.push(...r.failed);
    await logChanges(admin, clientId, actor, moved.map((t) => {
      const o = originals.get(keyOf(t));
      return { action: "task.copy", summary: `Copied "${t.title}" from ${o ? from(o.month_id) : "another month"} to ${label}`, monthId: target.id, taskId: t.id,
        before: o ? { task_id: o.id, month: index.get(o.month_id) ?? null } : null, after: t };
    }));
  } else {
    const results = await eachLimit(ready, 6, async ({ task: t, due, sort: s }) => {
      const { data, error } = await admin.from("roadmap_tasks").update({ month_id: target.id, due_date: due, source: source(t), sort: s, updated_by: actor.userId })
        .eq("id", t.id).eq("client_id", clientId).select("*").single();
      if (!data) skipped.push(`${quote(t.title)} (${error?.code === "23505" ? `a task like this is already in ${label}` : "could not be moved"})`);
      return { t, row: data as RoadmapTask | null };
    });
    const ok = results.flatMap((r) => (r.row ? [{ t: r.t, row: r.row }] : []));
    moved = ok.map((r) => r.row);
    await logChanges(admin, clientId, actor, ok.map(({ t, row }) => ({
      action: "task.move", summary: `Moved "${t.title}" from ${from(t.month_id)} to ${label}`, monthId: target.id, taskId: t.id,
      before: { month: index.get(t.month_id) ?? null, due_date: t.due_date, source: t.source }, after: { month, due_date: row.due_date, source: row.source },
    })));
  }
  if (!moved.length) return { ok: false, error: `Nothing was ${verb}: ${listed(skipped)}` };
  return { ok: true, value: { moved, skipped }, message: `${mode.copy ? "Copied" : "Moved"} ${count(moved.length, "task")} to ${label}${skipped.length ? `. Skipped ${skipped.length}: ${listed(skipped)}` : ""}.` };
}

const itemRef = z.string().trim().min(1).max(300);
/** Checklist edits on one task. Items are named by their id, or by their exact text. */
export const checklistOps = z.object({
  add: list(20, 300).optional(),
  tick: z.array(itemRef).max(30).optional(),
  untick: z.array(itemRef).max(30).optional(),
  rename: z.array(z.object({ id: itemRef, text: str(300).min(1) })).max(30).optional(),
  remove: z.array(itemRef).max(30).optional(),
});
export type ChecklistOps = z.input<typeof checklistOps>;

/** A task's checklist after the edits: the new items, one line per real change, and problems (unknown items, contradictions). */
export function applyChecklist(items: Subtask[], ops: z.output<typeof checklistOps>): { next: Subtask[]; lines: string[]; errors: string[] } {
  const errors: string[] = [], lines: string[] = [];
  /** the item, or why it can't be found (an ambiguous text is never guessed) */
  const find = (ref: string): Subtask | string => {
    const byId = items.find((s) => s.id === ref);
    if (byId) return byId;
    const byText = items.filter((s) => s.text.trim().toLowerCase() === ref.toLowerCase());
    return byText.length === 1 ? byText[0] : byText.length ? `${byText.length} items say ${quote(ref)}: use the item id` : `no checklist item ${quote(ref)}`;
  };
  const one = (ref: string) => { const s = find(ref); if (typeof s === "string") errors.push(s); return typeof s === "string" ? [] : [s]; };
  const pick = (refs: string[] | undefined) => (refs ?? []).flatMap(one);
  const tick = pick(ops.tick), untick = pick(ops.untick), remove = pick(ops.remove);
  const rename = (ops.rename ?? []).flatMap((r) => one(r.id).map((s) => ({ s, text: r.text })));
  const removing = new Set(remove.map((s) => s.id)), unticking = new Set(untick.map((s) => s.id));
  for (const s of tick) if (unticking.has(s.id)) errors.push(`${quote(s.text)} can't be ticked and unticked at once`);
  for (const s of [...tick, ...untick, ...rename.map((r) => r.s)]) if (removing.has(s.id)) errors.push(`${quote(s.text)} can't be changed and removed at once`);
  if (errors.length) return { next: items, lines, errors: [...new Set(errors)] };

  const next = new Map(items.map((s) => [s.id, { ...s }]));
  for (const s of remove) if (next.delete(s.id)) lines.push(`Remove ${quote(s.text)}`);
  for (const { s, text } of rename) { const x = next.get(s.id)!; if (x.text !== text) { lines.push(`Rename ${quote(x.text)} → ${quote(text)}`); x.text = text; } }
  for (const s of tick) { const x = next.get(s.id)!; if (!x.done) { x.done = true; lines.push(`Tick ${quote(x.text)}`); } }
  for (const s of untick) { const x = next.get(s.id)!; if (x.done) { x.done = false; lines.push(`Untick ${quote(x.text)}`); } }
  const texts = new Set([...next.values()].map((s) => s.text.trim().toLowerCase()));
  for (const text of ops.add ?? []) {
    if (texts.has(text.toLowerCase())) continue;
    texts.add(text.toLowerCase());
    const s = { id: randomUUID().slice(0, 8), text, done: false };
    next.set(s.id, s);
    lines.push(`Add ${quote(text)}`);
  }
  if (next.size > 30) errors.push(`a checklist holds at most 30 items (this would make ${next.size})`);
  return { next: [...next.values()], lines, errors };
}

export async function editChecklist(admin: SupabaseClient, clientId: string, id: string, raw: ChecklistOps, actor: Actor): Promise<WriteResult<RoadmapTask>> {
  const p = checklistOps.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid change: ${issues(p.error)}` };
  const t = await ownTask(admin, clientId, id);
  if (!t) return { ok: false, error: "That task doesn't exist for this client." };
  const r = applyChecklist(t.subtasks, p.data);
  if (r.errors.length) return { ok: false, error: `Couldn't edit the checklist of "${t.title}": ${r.errors.join("; ")}.` };
  if (!r.lines.length) return { ok: true, value: t, message: `The checklist of "${t.title}" already looks like that.` };
  const { data, error } = await admin.from("roadmap_tasks").update({ subtasks: r.next, updated_by: actor.userId }).eq("id", t.id).eq("client_id", clientId).select("*").single();
  if (error || !data) return { ok: false, error: "Could not update the checklist." };
  await logChange(admin, clientId, actor, { action: "task.checklist", summary: `Checklist of "${t.title}": ${r.lines.join("; ")}`, monthId: t.month_id, taskId: t.id, before: { subtasks: t.subtasks }, after: { subtasks: r.next } });
  return { ok: true, value: data as RoadmapTask, message: `Updated the checklist of "${t.title}" (${r.next.filter((s) => s.done).length}/${r.next.length} done).` };
}

/** A task as searchTasks returns it (without evidence and steps). */
export type TaskSummary = Omit<RoadmapTask, "evidence" | "steps">;
export type TaskSearch = { text?: string; category?: string; statuses?: string[]; priority?: string; source?: string; monthIds?: string[]; dueBefore?: string };

/** This client's tasks across months matching the filters. Every word of `text` must appear in the title, description, why, keywords, pages or checklist. */
export async function searchTasks(db: SupabaseClient, clientId: string, f: TaskSearch): Promise<TaskSummary[]> {
  if (f.monthIds && !f.monthIds.length) return [];
  const tasks = await pages<TaskSummary>((from, to) => {
    let q = db.from("roadmap_tasks").select("id, client_id, month_id, category, title, description, why, keywords, urls, subtasks, priority, impact, effort, status, due_date, source, sort, completed_at, created_at, updated_at, dedupe_key").eq("client_id", clientId);
    if (f.category) q = q.eq("category", f.category);
    if (f.statuses?.length) q = q.in("status", f.statuses);
    if (f.priority) q = q.eq("priority", f.priority);
    if (f.source) q = q.eq("source", f.source);
    if (f.monthIds) q = q.in("month_id", f.monthIds);
    if (f.dueBefore) q = q.lt("due_date", f.dueBefore);
    return q.order("id").range(from, to);
  });
  const words = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tasks;
  return tasks.filter((t) => {
    const hay = [t.title, t.description, t.why, ...t.keywords, ...t.urls, ...t.subtasks.map((s) => s.text)].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Status, priority, category and due date of every task of this client (for per-month counts). */
export async function taskStats(db: SupabaseClient, clientId: string) {
  return pages<Pick<RoadmapTask, "month_id" | "category" | "status" | "priority" | "due_date">>((from, to) =>
    db.from("roadmap_tasks").select("month_id, category, status, priority, due_date").eq("client_id", clientId).order("id").range(from, to));
}

export type ChangeEntry = { id: string; created_at: string; actor: Actor["kind"]; user_id: string | null; action: string; summary: string; month_id: string | null; task_id: string | null; before: unknown; after: unknown };
export type ChangeSearch = { monthId?: string; taskId?: string; actor?: string; action?: string; since?: string; summaryHas?: string; limit: number };

/** The roadmap's change history, newest first, and how many entries match in all. `action`: "task.delete", or "task" for every task.* entry. */
export async function listChanges(db: SupabaseClient, clientId: string, f: ChangeSearch): Promise<{ rows: ChangeEntry[]; total: number }> {
  let q = db.from("roadmap_changes").select("id, created_at, actor, user_id, action, summary, month_id, task_id, before, after", { count: "exact" }).eq("client_id", clientId);
  if (f.monthId) q = q.eq("month_id", f.monthId);
  if (f.taskId) q = q.eq("task_id", f.taskId);
  if (f.actor) q = q.eq("actor", f.actor);
  if (f.action) q = f.action.includes(".") ? q.eq("action", f.action) : q.like("action", `${f.action.replace(/[%_]/g, "")}.%`);
  if (f.since) q = q.gte("created_at", f.since);
  if (f.summaryHas) q = q.ilike("summary", `%${f.summaryHas.replace(/[%_]/g, "")}%`);
  const { data, error, count: total } = await q.order("created_at", { ascending: false }).limit(f.limit);
  if (error) throw error;
  return { rows: (data ?? []) as ChangeEntry[], total: total ?? 0 };
}
