import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CATEGORY_KEYS, dedupeKey, EFFORTS, LEVELS, STATUSES, type RoadmapMonth, type RoadmapTask, type Subtask } from "./types";

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

export async function logChange(admin: SupabaseClient, clientId: string, actor: Actor, c: { action: string; summary: string; monthId?: string | null; taskId?: string | null; before?: unknown; after?: unknown }) {
  await admin.from("roadmap_changes").insert({
    client_id: clientId, month_id: c.monthId ?? null, task_id: c.taskId ?? null, actor: actor.kind, user_id: actor.userId,
    action: c.action, summary: c.summary.slice(0, 500), before: c.before ?? null, after: c.after ?? null,
  });
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
  /** replaces the whole checklist */
  subtasks: z.array(z.object({ id: z.string().max(60).optional(), text: str(300).min(1), done: z.boolean().default(false) })).max(20).optional(),
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

export async function updateMonth(admin: SupabaseClient, clientId: string, month: string, raw: MonthPatch, actor: Actor): Promise<WriteResult<RoadmapMonth>> {
  const p = monthPatch.safeParse(raw);
  if (!p.success) return { ok: false, error: `Invalid change: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}` };
  const before = await ensureMonth(admin, clientId, month, actor);
  const { data, error } = await admin.from("roadmap_months").update(p.data).eq("id", before.id).eq("client_id", clientId).select(MONTH_COLS).single();
  if (error) return { ok: false, error: "Could not update the month." };
  await logChange(admin, clientId, actor, { action: "month.update", summary: `Updated the ${month.slice(0, 7)} strategy (${Object.keys(p.data).join(", ")})`, monthId: before.id, before, after: data });
  return { ok: true, value: data as RoadmapMonth, message: "Strategy updated." };
}

export function progress(tasks: Pick<RoadmapTask, "status" | "category" | "priority">[]) {
  const counted = tasks.filter((t) => t.status !== "skipped");
  const done = counted.filter((t) => t.status === "done").length;
  return { total: counted.length, done, open: counted.length - done, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}
