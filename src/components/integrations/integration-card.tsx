"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, RefreshCw } from "lucide-react";
import { PROVIDER_META, type ProviderId } from "@/lib/integrations/providers";
import { cn } from "@/lib/utils";

export interface ResourceRow {
  id: string;
  external_id: string;
  display_name: string | null;
  timezone: string | null;
  is_selected: boolean;
}
export interface ProviderStatus {
  connection: {
    status: "pending" | "connected" | "disconnected" | "error";
    account_email: string | null;
    last_error: string | null;
    last_synced_at: string | null;
  } | null;
  resources: ResourceRow[];
  last_job: { status: string; job_type: string; error: string | null; finished_at: string | null } | null;
  syncing: boolean;
}

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium outline-none transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

export function IntegrationCard({
  provider, status, canEdit, available = true,
}: { provider: ProviderId; status: ProviderStatus; canEdit: boolean; available?: boolean }) {
  const router = useRouter();
  const meta = PROVIDER_META[provider];
  const conn = status.connection;
  const state = conn?.status ?? "disconnected";
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    new Set(status.resources.filter((r) => r.is_selected).map((r) => r.id)),
  );

  // synchronous guard: state updates are async, so a fast double click could otherwise send two requests
  const inFlight = useRef(false);
  useEffect(() => {
    // Back from Google can restore this page from the bfcache with the lock still held
    const reset = () => { inFlight.current = false; setBusy(null); };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function call(action: string, body?: unknown) {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/integrations/${provider}/${action}`, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      return json;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(null);
      // keep the lock after a successful connect: we are about to navigate to Google
      if (action !== "connect") inFlight.current = false;
    }
  }

  async function connect() {
    const json = await call("connect");
    if (json?.redirectUrl) window.location.href = json.redirectUrl;
    else inFlight.current = false;
  }
  async function save() {
    const json = await call("select", { resourceIds: [...picked] });
    if (json) {
      setMessage(
        json.queued > 0 ? "Saved. Import queued: recent data first, then older history in the background." : "Saved.",
      );
      router.refresh();
    }
  }
  async function sync() {
    const json = await call("sync");
    if (json) {
      setMessage(json.queued > 0 ? "Sync queued." : "A sync is already queued or running.");
      router.refresh();
    }
  }
  async function disconnect() {
    if (!confirm(`Disconnect ${meta.label}? Stored history is kept; syncing stops.`)) return;
    if (await call("disconnect")) router.refresh();
  }

  const badge =
    state === "connected"
      ? { icon: CheckCircle2, text: "Connected", cls: "text-positive" }
      : state === "error"
        ? { icon: AlertTriangle, text: "Error", cls: "text-negative" }
        : state === "pending"
          ? { icon: Loader2, text: "Pending", cls: "text-muted" }
          : { icon: CircleSlash, text: "Disconnected", cls: "text-muted" };
  const Badge = badge.icon;

  const selected = status.resources.filter((r) => r.is_selected);
  const dirty =
    picked.size !== selected.length || selected.some((r) => !picked.has(r.id));

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby={`${provider}-title`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${provider}-title`} className="text-base font-semibold">{meta.label}</h2>
        <span className={cn("inline-flex items-center gap-1 text-sm font-medium", badge.cls)}>
          <Badge className={cn("size-4", state === "pending" && "animate-spin")} aria-hidden /> {badge.text}
        </span>
      </div>

      {!available ? (
        <div className="space-y-2 text-sm text-muted">
          <p>
            {meta.label} connects with its own Google OAuth client. Add GOOGLE_GBP_CLIENT_ID,
            GOOGLE_GBP_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY to the environment, then redeploy.
          </p>
          <button className={btn} disabled>Connect Account</button>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Account</dt>
            <dd className="truncate">{conn?.account_email ?? (state === "connected" ? "Connected (email not provided)" : "—")}</dd>
            <dt className="text-muted">Tracking</dt>
            <dd className="truncate">
              {selected.length ? selected.map((r) => r.display_name ?? r.external_id).join(", ") : "Nothing selected"}
            </dd>
            <dt className="text-muted">Last sync</dt>
            <dd>
              {conn?.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : "Never"}
              {status.syncing && <span className="ml-2 text-muted">(sync in progress)</span>}
            </dd>
          </dl>

          {(conn?.last_error || (status.last_job?.status === "failed" && status.last_job.error)) && state !== "disconnected" && (
            <p role="alert" className="rounded-lg bg-accent-soft p-2 text-sm text-negative">
              {conn?.last_error ?? status.last_job?.error}
            </p>
          )}

          {state === "connected" && (
            <fieldset className="space-y-1.5" disabled={!canEdit}>
              <legend className="mb-1 text-sm font-medium">
                Choose {meta.resourceNoun}s to track
              </legend>
              {status.resources.length === 0 ? (
                <p className="text-sm text-muted">No {meta.resourceNoun}s were found for this Google account.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {status.resources.map((r) => (
                    <li key={r.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-muted">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)]"
                          checked={picked.has(r.id)}
                          onChange={(e) =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(r.id); else next.delete(r.id);
                              return next;
                            })
                          }
                        />
                        <span className="truncate">{r.display_name ?? r.external_id}</span>
                        {r.timezone && <span className="ml-auto shrink-0 text-xs text-muted">{r.timezone}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {dirty && (
                <button type="button" className={btnPrimary} onClick={save} disabled={busy !== null}>
                  {busy === "select" && <Loader2 className="size-4 animate-spin" />} Save selection
                </button>
              )}
            </fieldset>
          )}

          <div className="mt-auto flex flex-wrap gap-2">
            {state === "connected" ? (
              <>
                <button className={btn} onClick={sync} disabled={!canEdit || busy !== null || selected.length === 0}>
                  {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync Now
                </button>
                <button className={btn} onClick={disconnect} disabled={!canEdit || busy !== null}>Disconnect</button>
              </>
            ) : state === "error" ? (
              <>
                <button className={btnPrimary} onClick={connect} disabled={!canEdit || busy !== null}>Reconnect</button>
                <button className={btn} onClick={disconnect} disabled={!canEdit || busy !== null}>Disconnect</button>
              </>
            ) : (
              <button className={btnPrimary} onClick={connect} disabled={!canEdit || busy !== null}>
                {busy === "connect" && <Loader2 className="size-4 animate-spin" />} Connect Account
              </button>
            )}
          </div>
        </>
      )}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </section>
  );
}
