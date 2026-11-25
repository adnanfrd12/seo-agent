"use server";

import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { revalidatePath } from "@/lib/revalidate";
import { generateMonth } from "@/lib/roadmap/generate";
import { addTask, deleteTask, toggleSubtask, updateMonth, updateTask, type Actor, type MonthPatch, type TaskInput, type TaskPatch } from "@/lib/roadmap/store";
import { STATUSES } from "@/lib/roadmap/types";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };
const month = z.string().regex(/^\d{4}-\d{2}-01$/);

async function ctx(edit: boolean) {
  const { user, client } = await getSession();
  if (!client) throw new Error("No client");
  const canEdit = ["owner", "admin"].includes(client.role);
  return { client, actor: { kind: "user", userId: user.id } as Actor, allowed: edit ? canEdit : true };
}
const denied: Result = { ok: false, error: "Only owners and admins can change the roadmap." };
const done = (r: { ok: true; message: string } | { ok: false; error: string }): Result => { revalidatePath("/roadmap"); return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error }; };

export async function generateRoadmap(m: string, focus?: string): Promise<Result> {
  if (!month.safeParse(m).success) return { ok: false, error: "Invalid month." };
  const { client, actor, allowed } = await ctx(true);
  if (!allowed) return denied;
  const r = await generateMonth(createAdminClient(), client.id, client.timezone, m, actor, { focus: focus?.trim().slice(0, 400) || null });
  revalidatePath("/roadmap");
  return r.ok ? { ok: true, message: `Strategy ready: ${r.added} new tasks${r.kept ? `, ${r.kept} kept` : ""}${r.removed ? `, ${r.removed} open AI tasks replaced` : ""}.` } : { ok: false, error: r.error };
}

export async function addRoadmapTask(m: string, input: TaskInput): Promise<Result> {
  if (!month.safeParse(m).success) return { ok: false, error: "Invalid month." };
  const { client, actor, allowed } = await ctx(true);
  if (!allowed) return denied;
  return done(await addTask(createAdminClient(), client.id, m, input, actor));
}

export async function updateRoadmapTask(id: string, patch: TaskPatch): Promise<Result> {
  const { client, actor, allowed } = await ctx(true);
  if (!allowed) return denied;
  return done(await updateTask(createAdminClient(), client.id, id, patch, actor));
}

/** Any member can track progress (like the 30-day strategy). */
export async function setRoadmapTaskStatus(id: string, status: string): Promise<Result> {
  const s = z.enum(STATUSES).safeParse(status);
  if (!s.success) return { ok: false, error: "Invalid status." };
  const { client, actor } = await ctx(false);
  return done(await updateTask(createAdminClient(), client.id, id, { status: s.data }, actor));
}

export async function toggleRoadmapSubtask(id: string, subId: string, value: boolean): Promise<Result> {
  const { client, actor } = await ctx(false);
  return done(await toggleSubtask(createAdminClient(), client.id, id, String(subId).slice(0, 60), Boolean(value), actor));
}

export async function deleteRoadmapTask(id: string): Promise<Result> {
  const { client, actor, allowed } = await ctx(true);
  if (!allowed) return denied;
  return done(await deleteTask(createAdminClient(), client.id, id, actor));
}

export async function updateRoadmapMonth(m: string, patch: MonthPatch): Promise<Result> {
  if (!month.safeParse(m).success) return { ok: false, error: "Invalid month." };
  const { client, actor, allowed } = await ctx(true);
  if (!allowed) return denied;
  return done(await updateMonth(createAdminClient(), client.id, m, patch, actor));
}
