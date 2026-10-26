"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { connectLbm, disconnectLbm, lbmLocations, selectLbmLocations, syncLbmNow, type LbmLocationOption } from "./lbm-actions";

const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";

export function LbmPanel({ connected, canEdit, hasEnvToken, selected }: {
  connected: boolean; canEdit: boolean; hasEnvToken: boolean; selected: { lbmId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = useState("");
  const [locations, setLocations] = useState<LbmLocationOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(selected.map((s) => s.lbmId)));
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); });

  useEffect(() => {
    if (!connected || !canEdit) return;
    let live = true;
    lbmLocations().then((r) => { if (!live) return; if (r.ok) setLocations(r.locations); else setMsg({ ok: false, text: r.error }); });
    return () => { live = false; };
  }, [connected, canEdit]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = locations ?? [];
    return (q ? list.filter((l) => `${l.name} ${l.address ?? ""}`.toLowerCase().includes(q)) : list)
      .sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id))).slice(0, 60);
  }, [locations, query, picked]);
  const dirty = picked.size !== selected.length || selected.some((s) => !picked.has(s.lbmId));
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>;

  if (!canEdit) return <p className="text-sm text-muted">Only owners and admins can manage this connection.</p>;
  if (!connected) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="lbm-token">API token</label>
        <input id="lbm-token" type="password" autoComplete="off" className={input} value={token} onChange={(e) => setToken(e.target.value)}
          placeholder={hasEnvToken ? "Leave empty to use the token configured on the server" : "Token from app.localbrandmanager.com/api_tokens"} />
        <button className={btn} disabled={pending || (!token.trim() && !hasEnvToken)} onClick={() => run(() => connectLbm(token))}>
          {pending && <Loader2 className="size-4 animate-spin" />} Connect Local Brand Manager
        </button>
        {note}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">This client&apos;s location(s)</legend>
        <input className={input} placeholder="Search locations by name or address…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search locations" />
        {locations === null ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Loading locations…</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {shown.map((l) => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-muted">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={picked.has(l.id)}
                    onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />
                  <span className="min-w-0"><span className="block truncate">{l.name}</span><span className="block truncate text-xs text-muted">{l.address ?? "No address"}{l.enabled ? "" : " · not enabled in LBM"}</span></span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-1 text-sm text-muted">No matching locations.</li>}
          </ul>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {dirty && locations && (
          <button className={btn} disabled={pending} onClick={() => run(() => selectLbmLocations(locations.filter((l) => picked.has(l.id)).map((l) => ({ id: l.id, gbpId: l.gbpId, name: l.name }))))}>
            {pending && <Loader2 className="size-4 animate-spin" />} Save selection
          </button>
        )}
        <button className={btn2} disabled={pending || selected.length === 0} onClick={() => run(syncLbmNow)}>Sync now</button>
        <button className={btn2} disabled={pending} onClick={() => { if (confirm("Disconnect Local Brand Manager? Stored history is kept.")) run(disconnectLbm); }}>Disconnect</button>
      </div>
      {note}
    </div>
  );
}
