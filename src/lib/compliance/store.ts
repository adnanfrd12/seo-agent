import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deletion requests and the deletion log. They live in the `data_deletion_requests` and `data_deletion_log` tables
 * (migration 20261124000024). Until that migration is applied, they fall back to JSON files in the private
 * Storage bucket "compliance", so a Meta/TikTok notification is never lost and its status page still works.
 */
export type DeletionSource = "dashboard" | "platform_webhook" | "revocation_detected" | "email";
export type DeletionStatus = "received" | "completed" | "not_found";

export interface DeletionRequest {
  id?: string;
  platform: string;
  platform_user_id: string | null;
  workspace_id: string | null;
  source: DeletionSource;
  confirmation_code: string;
  status: DeletionStatus;
  created_at: string;
  completed_at: string | null;
}

export interface DeletionLogEntry {
  at: string;
  action: "connection_deleted" | "workspace_deleted" | "notification_received";
  platform: string;
  reason: string;
  /** IDs only: connection / workspace / platform user. No names, emails or tokens. */
  connection_ref: string | null;
  workspace_id: string | null;
  platform_user_id: string | null;
  detail: Record<string, unknown>;
}

const BUCKET = "compliance";
/** "relation does not exist" from Postgres or PostgREST's schema cache */
const missingTable = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|schema cache/i.test(e.message ?? "")));

let bucketReady = false;
async function bucket(admin: SupabaseClient) {
  if (bucketReady) return;
  const { error } = await admin.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Compliance storage unavailable: ${error.message}`);
  bucketReady = true;
}
async function putJson(admin: SupabaseClient, path: string, data: unknown) {
  await bucket(admin);
  const { error } = await admin.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(data)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`Couldn't store ${path}: ${error.message}`);
}
async function getJson<T>(admin: SupabaseClient, path: string): Promise<T | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()) as T; } catch { return null; }
}

export async function insertRequest(admin: SupabaseClient, r: DeletionRequest): Promise<void> {
  const { error } = await admin.from("data_deletion_requests").insert(r);
  if (!error) return;
  if (!missingTable(error)) throw new Error(`Couldn't record the deletion request: ${error.message}`);
  await putJson(admin, `requests/${r.confirmation_code}.json`, r);
}

/** `base` (the full record as inserted) avoids re-reading a just-written Storage file, which can still be stale. */
export async function updateRequest(admin: SupabaseClient, code: string, patch: Partial<DeletionRequest>, base?: DeletionRequest): Promise<void> {
  const { error } = await admin.from("data_deletion_requests").update(patch).eq("confirmation_code", code);
  if (!error) return;
  if (!missingTable(error)) throw new Error(`Couldn't update the deletion request: ${error.message}`);
  const cur = base ?? (await getJson<DeletionRequest>(admin, `requests/${code}.json`));
  if (cur) await putJson(admin, `requests/${code}.json`, { ...cur, ...patch });
}

export async function findRequest(admin: SupabaseClient, code: string): Promise<Pick<DeletionRequest, "status" | "created_at" | "completed_at"> | null> {
  const { data, error } = await admin.from("data_deletion_requests").select("status, created_at, completed_at").eq("confirmation_code", code).maybeSingle();
  if (!error && data) return data;
  if (error && !missingTable(error)) throw new Error("Lookup failed");
  // not in the table: it may have been received before the migration was applied (Storage fallback)
  const r = await getJson<DeletionRequest>(admin, `requests/${code}.json`);
  return r ? { status: r.status, created_at: r.created_at, completed_at: r.completed_at } : null;
}

export async function logDeletion(admin: SupabaseClient, e: DeletionLogEntry): Promise<void> {
  console.info("[compliance]", JSON.stringify(e));
  const { error } = await admin.from("data_deletion_log").insert(e);
  if (!error) return;
  if (!missingTable(error)) return; // the console line above is the record of last resort
  try { await putJson(admin, `log/${e.at.slice(0, 10)}/${e.at.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`, e); } catch { /* logged to console */ }
}
