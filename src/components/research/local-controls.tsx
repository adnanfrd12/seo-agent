"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPinned, RefreshCw, Users } from "lucide-react";
import { checkReviews, compareRivals, refreshLocal, runMapsGrid } from "@/app/(dashboard)/local-seo/actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const field = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
type R = { ok: true; message: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>, after?: (r: R) => void) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    after?.(r);
    router.refresh();
  });
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>;
  return { pending, run, note };
}

/** Refreshes the profile and starts a review collection; while reviews are being collected it checks every 15 seconds (free). */
export function LocalRefresh({ canEdit, waiting, hasData }: { canEdit: boolean; waiting: boolean; hasData: boolean }) {
  const router = useRouter();
  const { pending, run, note } = useRun();
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => { const r = await checkReviews(); if (r.done || !r.pending) router.refresh(); }, 15_000);
    return () => clearInterval(t);
  }, [waiting, router]);
  return (
    <div className="space-y-1.5">
      {canEdit ? (
        <button className={btn} disabled={pending} onClick={() => run(refreshLocal)}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {hasData ? "Refresh profile and reviews" : "Load profile and reviews"} <span className="opacity-70">(≈1.5¢)</span>
        </button>
      ) : <p className="text-xs text-muted">Only owners and admins can refresh this data.</p>}
      {waiting && <p className="flex items-center gap-1.5 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Collecting reviews from Google. This page updates by itself.</p>}
      {note}
    </div>
  );
}

export function GridForm({ canEdit, suggestions }: { canEdit: boolean; suggestions: string[] }) {
  const { pending, run, note } = useRun();
  const [kw, setKw] = useState(suggestions[0] ?? "");
  const [size, setSize] = useState<3 | 5>(3);
  const [km, setKm] = useState(2);
  if (!canEdit) return null;
  const est = ((size * size) * 0.0025).toFixed(3);
  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Keyword
          <input className={`${field} mt-1 block w-64`} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="led signs near me" list="grid-kw" />
          <datalist id="grid-kw">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="text-sm">Grid
          <select className={`${field} mt-1 block`} value={size} onChange={(e) => setSize(Number(e.target.value) as 3 | 5)}><option value={3}>3 × 3 (9 points)</option><option value={5}>5 × 5 (25 points)</option></select>
        </label>
        <label className="text-sm">Spacing
          <select className={`${field} mt-1 block`} value={km} onChange={(e) => setKm(Number(e.target.value))}>{[0.5, 1, 2, 3, 5].map((k) => <option key={k} value={k}>{k} km</option>)}</select>
        </label>
        <button className={btn} disabled={pending || kw.trim().length < 2} onClick={() => run(() => runMapsGrid(kw, size, km))}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <MapPinned className="size-4" />} Scan map rankings <span className="opacity-70">(≈${est})</span>
        </button>
      </div>
      {pending && <p className="text-xs text-muted">Searching Google Maps at each point. This takes up to a minute.</p>}
      {note}
    </div>
  );
}

export function RivalForm({ canEdit, suggestions }: { canEdit: boolean; suggestions: string[] }) {
  const { pending, run, note } = useRun();
  const [text, setText] = useState(suggestions.slice(0, 3).join("\n"));
  if (!canEdit) return null;
  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-surface p-4">
      <label className="block text-sm">Competing businesses <span className="text-muted">(one per line, up to 3; pre-filled with the businesses that beat you on the map)</span>
        <textarea className={`${field} mt-1 block min-h-20 w-full`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Competitor sign shop\nAnother sign company"} />
      </label>
      <button className={btn} disabled={pending || !text.trim()} onClick={() => run(() => compareRivals(text))}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />} Compare profiles and reviews <span className="opacity-70">(≈1.2¢ each)</span>
      </button>
      {note}
    </div>
  );
}
