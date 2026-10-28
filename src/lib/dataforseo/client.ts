import "server-only";

/**
 * DataForSEO API v3 (HTTP Basic auth: API login + API password, sent on the server only).
 * All endpoints used here are Live calls billed per request (~$0.01-0.03, plus a tiny per-row cost).
 * Callers must go through budget.ts + research.ts so nothing is fetched twice or beyond the cap.
 */
const BASE = "https://api.dataforseo.com/v3";

export type DfsErrorKind = "config" | "auth" | "payment" | "rate_limit" | "bad_request" | "other";
export class DfsError extends Error {
  constructor(message: string, public kind: DfsErrorKind) { super(message); }
}

export const dfsConfigured = () => Boolean(process.env.DATAFORSEO_LOGIN?.trim() && process.env.DATAFORSEO_PASSWORD?.trim());

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) throw new DfsError("DataForSEO isn't configured (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).", "config");
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

type TaskResponse = {
  status_code: number; status_message: string; cost?: number;
  tasks?: { status_code: number; status_message: string; cost?: number; result?: Record<string, unknown>[] | null }[];
};

/** One Live call. Returns the first result object (or null when DataForSEO has no data) and what it cost. */
export async function dfsPost(path: string, body: Record<string, unknown>): Promise<{ result: Record<string, unknown> | null; cost: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify([body]),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });
    } catch (e) {
      // the request never got an answer, so nothing was billed: safe to retry
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 401) throw new DfsError("DataForSEO rejected the login. Check DATAFORSEO_LOGIN and the API password.", "auth");
    if (res.status === 402) throw new DfsError("DataForSEO credit is used up. Top up the balance.", "payment");
    if (res.status === 429 || res.status >= 500) {
      lastErr = new DfsError(`DataForSEO is busy (${res.status}).`, "rate_limit");
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const json = (await res.json().catch(() => null)) as TaskResponse | null;
    const task = json?.tasks?.[0];
    if (!json || !task) throw new DfsError("DataForSEO returned an unreadable response.", "other");
    const cost = Number(task.cost ?? json.cost ?? 0) || 0;
    if (task.status_code === 20000) return { result: task.result?.[0] ?? null, cost };
    if (task.status_code === 40102) return { result: null, cost }; // "No Search Results": a valid empty answer
    if (task.status_code === 40200 || json.status_code === 40200) throw new DfsError("DataForSEO credit is used up. Top up the balance.", "payment");
    if (task.status_code === 40101 || task.status_code === 40100) throw new DfsError("DataForSEO rejected the login.", "auth");
    if (task.status_code === 40202 || task.status_code === 50301) throw new DfsError("DataForSEO rate limit reached. Try again shortly.", "rate_limit");
    throw new DfsError(`DataForSEO: ${task.status_message} (${task.status_code})`, task.status_code >= 40000 && task.status_code < 50000 ? "bad_request" : "other");
  }
  throw lastErr instanceof DfsError ? lastErr : new DfsError("Couldn't reach DataForSEO. Try again.", "other");
}

/**
 * Posts an asynchronous task (the On-Page crawler) and returns its id. Unlike a Live call the answer
 * arrives later, so the id is stored and the result is collected with dfsGet. Once DataForSEO has
 * answered, the task exists and is billed, so a response is never retried.
 */
export async function dfsTaskPost(path: string, body: Record<string, unknown>): Promise<{ id: string; cost: number }> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try {
      res = await fetch(`${BASE}${path}`, {
        method: "POST", headers: { Authorization: authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify([body]), signal: AbortSignal.timeout(45_000), cache: "no-store",
      });
    } catch { await new Promise((r) => setTimeout(r, 1500)); }
  }
  if (!res) throw new DfsError("Couldn't reach DataForSEO. Try again.", "other");
  if (res.status === 401) throw new DfsError("DataForSEO rejected the login. Check DATAFORSEO_LOGIN and the API password.", "auth");
  if (res.status === 402) throw new DfsError("DataForSEO credit is used up. Top up the balance.", "payment");
  if (res.status === 429 || res.status >= 500) throw new DfsError(`DataForSEO is busy (${res.status}). Try again shortly.`, "rate_limit");
  const json = (await res.json().catch(() => null)) as (TaskResponse & { tasks?: { id?: string }[] }) | null;
  const task = json?.tasks?.[0];
  if (!json || !task) throw new DfsError("DataForSEO returned an unreadable response.", "other");
  if (task.status_code === 40200 || json.status_code === 40200) throw new DfsError("DataForSEO credit is used up. Top up the balance.", "payment");
  if (task.status_code !== 20100 || !task.id) throw new DfsError(`DataForSEO: ${task.status_message} (${task.status_code})`, "bad_request");
  return { id: task.id, cost: Number(task.cost ?? json.cost ?? 0) || 0 };
}

/** A free GET (task status). Returns the task's own status code so callers can tell "not found" from "still running". */
export async function dfsGet(path: string): Promise<{ status: number; result: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (res.status === 401) throw new DfsError("DataForSEO rejected the login.", "auth");
  const json = (await res.json().catch(() => null)) as TaskResponse | null;
  const task = json?.tasks?.[0];
  if (!task) throw new DfsError("DataForSEO returned an unreadable response.", "other");
  return { status: task.status_code, result: task.result?.[0] ?? null };
}

let balanceCache: { at: number; value: number | null } | null = null;
/** Account balance (a free endpoint). Cached for 5 minutes. */
export async function dfsBalance(): Promise<number | null> {
  if (balanceCache && Date.now() - balanceCache.at < 300_000) return balanceCache.value;
  try {
    const res = await fetch(`${BASE}/appendix/user_data`, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    const j = (await res.json()) as TaskResponse;
    const money = (j.tasks?.[0]?.result?.[0] as { money?: { balance?: number } } | undefined)?.money;
    balanceCache = { at: Date.now(), value: typeof money?.balance === "number" ? money.balance : null };
  } catch {
    balanceCache = { at: Date.now(), value: null };
  }
  return balanceCache.value;
}
