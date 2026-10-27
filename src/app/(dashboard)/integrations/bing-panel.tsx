"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { bingSites, connectBing, disconnectBing, selectBingSites, syncBingNow, type BingSiteOption } from "./bing-actions";

const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

export function BingPanel({ connected, canEdit, hasEnvKey, selected, suggest }: {
  connected: boolean; canEdit: boolean; hasEnvKey: boolean; selected: string[];
  /** hostnames of this client's Search Console / GA4 sites, used to put the matching Bing site first */
  suggest: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState("");
  const [sites, setSites] = useState<BingSiteOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); });

  useEffect(() => {
    if (!connected || !canEdit) return;
    let live = true;
    bingSites().then((r) => { if (!live) return; if (r.ok) setSites(r.sites); else setMsg({ ok: false, text: r.error }); });
    return () => { live = false; };
  }, [connected, canEdit]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hint = new Set(suggest.map(host));
    const rank = (s: BingSiteOption) => (picked.has(s.url) ? 0 : hint.has(host(s.url)) ? 1 : 2);
    return (sites ?? []).filter((s) => !q || s.url.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.url.localeCompare(b.url));
  }, [sites, query, picked, suggest]);
  const dirty = picked.size !== selected.length || selected.some((s) => !picked.has(s));
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>;

  if (!canEdit) return <p className="text-sm text-muted">Only owners and admins can manage this connection.</p>;
  if (!connected) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="bing-key">API key</label>
        <input id="bing-key" type="password" autoComplete="off" className={input} value={key} onChange={(e) => setKey(e.target.value)}
          placeholder={hasEnvKey ? "Leave empty to use the key configured on the server" : "Bing Webmaster Tools → Settings → API access"} />
        <button className={btn} disabled={pending || (!key.trim() && !hasEnvKey)} onClick={() => run(() => connectBing(key))}>
          {pending && <Loader2 className="size-4 animate-spin" />} Connect Bing Webmaster Tools
        </button>
        {note}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">This client&apos;s site(s)</legend>
        <input className={input} placeholder="Search sites…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search Bing sites" />
        {sites === null ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Loading sites…</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {shown.map((s) => (
              <li key={s.url}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-muted">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={picked.has(s.url)} disabled={!s.verified && !picked.has(s.url)}
                    onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.url); else n.delete(s.url); return n; })} />
                  <span className="min-w-0 truncate">{s.url}</span>
                  {!s.verified && <span className="ml-auto shrink-0 text-xs text-negative">not verified</span>}
                  {s.verified && suggest.map(host).includes(host(s.url)) && <span className="ml-auto shrink-0 text-xs text-positive">matches Search Console</span>}
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-1 text-sm text-muted">No matching sites.</li>}
          </ul>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {dirty && sites && (
          <button className={btn} disabled={pending} onClick={() => run(() => selectBingSites([...picked]))}>
            {pending && <Loader2 className="size-4 animate-spin" />} Save selection
          </button>
        )}
        <button className={btn2} disabled={pending || selected.length === 0} onClick={() => run(syncBingNow)}>Sync now</button>
        <button className={btn2} disabled={pending} onClick={() => { if (confirm("Disconnect Bing? Stored history is kept.")) run(disconnectBing); }}>Disconnect</button>
      </div>
      {note}
    </div>
  );
}
