"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { lbmBulkCreate, lbmBulkPreview, type BulkLocation } from "./lbm-bulk-actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const input = "w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const BATCH = 100;

/** One-click setup: a dashboard client per Local Brand Manager location, with LBM and matching Bing connected. */
export function LbmBulkSetup() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<BulkLocation[] | null>(null);
  const [bingAvailable, setBingAvailable] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [withBing, setWithBing] = useState(true);
  const [copyTeam, setCopyTeam] = useState(true);
  const [onlyEnabled, setOnlyEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => start(async () => {
    setMsg(null);
    const r = await lbmBulkPreview();
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setRows(r.locations);
    setBingAvailable(r.bingAvailable);
    // default: enabled, verified locations that no client uses yet
    setPicked(new Set(r.locations.filter((l) => !l.existingClient && l.enabled && /verified/.test(l.status)).map((l) => l.id)));
    // make duplicate names unique by adding the city from the address
    const counts = new Map<string, number>();
    for (const l of r.locations) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
    setNames(Object.fromEntries(r.locations.map((l) => {
      const city = l.address?.split(",").at(-3)?.trim();
      return [l.id, counts.get(l.name)! > 1 && city ? `${l.name} (${city})` : l.name];
    })));
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((l) => (!onlyEnabled || l.enabled) && (!q || `${l.name} ${l.address ?? ""}`.toLowerCase().includes(q)));
  }, [rows, query, onlyEnabled]);
  const chosen = (rows ?? []).filter((l) => picked.has(l.id) && !l.existingClient);

  const create = () => {
    if (!chosen.length) return;
    if (!confirm(`Create ${chosen.length} client${chosen.length > 1 ? "s" : ""} and start importing their data?`)) return;
    start(async () => {
      let made = 0, bing = 0;
      const skipped: string[] = [], failed: string[] = [];
      for (let i = 0; i < chosen.length; i += BATCH) {
        const r = await lbmBulkCreate(chosen.slice(i, i + BATCH).map((l) => ({
          id: l.id, gbpId: l.gbpId, name: (names[l.id] ?? l.name).trim() || l.name, timezone: l.timezone,
          bingSite: withBing ? l.bingSite : null,
        })), copyTeam);
        if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
        made += r.created.length; bing += r.created.filter((c) => c.bing).length;
        skipped.push(...r.skipped); failed.push(...r.failed);
      }
      setMsg({
        ok: failed.length === 0,
        text: `Created ${made} client${made === 1 ? "" : "s"} (${bing} with Bing). Imports have started and finish in the background; the daily sync completes any that don't fit in the first run.`
          + (skipped.length ? ` Skipped ${skipped.length} already set up.` : "") + (failed.length ? ` Failed: ${failed.join(", ")}.` : ""),
      });
      setRows(null);
      router.refresh();
    });
  };

  if (!rows) {
    return (
      <div className="space-y-2">
        <button className={btn2} onClick={load} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />} Set up clients for all Local Brand Manager locations
        </button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
      </div>
    );
  }

  const toggleAll = (on: boolean) => setPicked((prev) => {
    const n = new Set(prev);
    for (const l of shown) if (!l.existingClient) { if (on) n.add(l.id); else n.delete(l.id); }
    return n;
  });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Bulk client setup · {rows.length} locations · {chosen.length} selected</p>
        <button className="text-xs text-muted hover:text-foreground" onClick={() => setRows(null)}>Close</button>
      </div>
      <p className="text-xs text-muted">
        Each selected location becomes its own dashboard client (you&apos;re the owner) with Local Brand Manager connected
        {bingAvailable ? " and, where its website matches a verified Bing site, Bing too" : ""}. Locations already used by a client are greyed out.
        GA4 and Search Console still need a Google sign-in per client.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <input className={`${input} max-w-xs`} placeholder="Search locations…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search locations" />
        <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--accent)]" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> Only locations enabled in LBM</label>
        {bingAvailable && <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--accent)]" checked={withBing} onChange={(e) => setWithBing(e.target.checked)} /> Connect matching Bing sites</label>}
        <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--accent)]" checked={copyTeam} onChange={(e) => setCopyTeam(e.target.checked)} /> Give this client&apos;s team the same access</label>
        <span className="flex gap-2 text-xs"><button className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground" onClick={() => toggleAll(true)}>Select shown</button><button className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground" onClick={() => toggleAll(false)}>Clear shown</button></span>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
            <tr><th className="w-8 px-2 py-2" /><th className="px-2 py-2 font-medium">Client name</th><th className="px-2 py-2 font-medium">Location</th><th className="px-2 py-2 font-medium">Bing site</th><th className="px-2 py-2 font-medium">Status</th></tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const done = Boolean(l.existingClient);
              return (
                <tr key={l.id} className={`border-t border-border align-top ${done ? "opacity-50" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" disabled={done} checked={!done && picked.has(l.id)} aria-label={`Select ${l.name}`}
                      onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />
                  </td>
                  <td className="px-2 py-1.5">
                    {done ? <span>{l.name}</span> : (
                      <input className={input} value={names[l.id] ?? l.name} onChange={(e) => setNames((n) => ({ ...n, [l.id]: e.target.value }))} aria-label={`Client name for ${l.name}`} />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted">{l.address ?? "No address"}<br />{l.timezone}</td>
                  <td className="px-2 py-1.5 text-xs">{l.bingSite ? <span className="break-all">{l.bingSite.replace(/^https?:\/\//, "")}</span> : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-1.5 text-xs">{done ? <span>Already set up in “{l.existingClient}”</span> : <span className="text-muted">{l.enabled ? "" : "not enabled · "}{l.status}</span>}</td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-muted">No matching locations.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={pending || chosen.length === 0} onClick={create}>
          {pending && <Loader2 className="size-4 animate-spin" />} Create {chosen.length} client{chosen.length === 1 ? "" : "s"}
        </button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
      </div>
    </div>
  );
}
