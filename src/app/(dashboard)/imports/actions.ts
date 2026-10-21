"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiErrorMessage } from "@/lib/ai/claude";
import { extractReport } from "@/lib/ai/extract-report";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const MAX = 20 * 1024 * 1024;
const BUCKET = "report-imports";

async function requireAdmin() {
  const { user, client } = await getSession();
  if (!client) throw new Error("No client");
  return { user, client, allowed: ["owner", "admin"].includes(client.role) };
}

/** Step 1: a one-time signed upload URL into the client's private folder. */
export async function createImportUpload(fileName: string, size: number): Promise<Result<{ path: string; token: string }>> {
  const p = z.object({ fileName: z.string().min(1).max(200), size: z.number().int().positive().max(MAX) }).safeParse({ fileName, size });
  if (!p.success) return { ok: false, error: "Choose a PDF up to 20 MB." };
  if (!/\.pdf$/i.test(fileName)) return { ok: false, error: "Only PDF files can be imported." };
  const { client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can import reports." };
  const path = `${client.id}/${randomUUID()}.pdf`;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Upload isn't available (has migration 20261021000011 been applied?)." };
  return { ok: true, path, token: data.token };
}

/** Step 2: validate the stored file, extract figures with AI, save as PENDING review. */
export async function processImport(path: string, fileName: string): Promise<Result<{ id: string }>> {
  const { user, client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can import reports." };
  if (!path.startsWith(`${client.id}/`) || !/^[0-9a-f-]+\/[0-9a-f-]+\.pdf$/.test(path)) return { ok: false, error: "Invalid upload." };
  const admin = createAdminClient();
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
  if (dlErr || !blob) return { ok: false, error: "The uploaded file wasn't found." };
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length > MAX || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    await admin.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "That file isn't a valid PDF." };
  }
  const { data: rep, error: repErr } = await admin.from("imported_reports").insert({
    client_id: client.id, storage_path: path, file_name: fileName.slice(0, 200), file_size: buf.length, uploaded_by: user.id,
  }).select("id").single();
  if (repErr || !rep) return { ok: false, error: "Could not record the import." };

  const { data: run } = await admin.from("ai_analysis_runs").insert({ client_id: client.id, kind: "import_extraction", status: "running", requested_by: user.id }).select("id").single();
  try {
    const { out, usage } = await extractReport(buf);
    const dateOk = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    const rows = out.metrics.map((m) => ({
      import_id: rep.id, client_id: client.id, page_number: m.page_number, source_name: m.source_name, original_label: m.original_label.slice(0, 300),
      normalized_metric: m.normalized_metric, value: m.value, value_text: m.value_text.slice(0, 300), unit: m.unit, confidence: m.confidence,
      period_start: dateOk(out.reporting_period_start), period_end: dateOk(out.reporting_period_end),
    }));
    if (rows.length) await admin.from("imported_report_metrics").insert(rows);
    await admin.from("imported_reports").update({
      status: "extracted", period_start: dateOk(out.reporting_period_start), period_end: dateOk(out.reporting_period_end),
      extraction: { title: out.report_title, notes: out.notes, metric_count: rows.length },
    }).eq("id", rep.id);
    if (run) await admin.from("ai_analysis_runs").update({ status: "succeeded", model: "claude-opus-5-5", ...usage, output: { import_id: rep.id, metrics: rows.length }, finished_at: new Date().toISOString() }).eq("id", run.id);
  } catch (e) {
    const msg = aiErrorMessage(e);
    await admin.from("imported_reports").update({ status: "failed", error: msg }).eq("id", rep.id);
    if (run) await admin.from("ai_analysis_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", run.id);
    revalidatePath("/imports");
    return { ok: false, error: msg };
  }
  revalidatePath("/imports");
  return { ok: true, id: rep.id };
}

/** Step 3: the reviewer accepts/rejects each figure and confirms. Accepted figures become AI evidence (labelled as imported). */
export async function confirmImport(importId: string, decisions: Record<string, "accepted" | "rejected">): Promise<Result> {
  const p = z.object({ importId: z.uuid(), decisions: z.record(z.uuid(), z.enum(["accepted", "rejected"])) }).safeParse({ importId, decisions });
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { client, allowed } = await requireAdmin();
  if (!allowed) return { ok: false, error: "Only owners and admins can confirm imports." };
  const admin = createAdminClient();
  for (const status of ["accepted", "rejected"] as const) {
    const ids = Object.entries(p.data.decisions).filter(([, s]) => s === status).map(([id]) => id);
    if (ids.length) await admin.from("imported_report_metrics").update({ review_status: status }).in("id", ids).eq("import_id", p.data.importId).eq("client_id", client.id);
  }
  await admin.from("imported_reports").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", p.data.importId).eq("client_id", client.id);
  revalidatePath("/imports");
  return { ok: true };
}
