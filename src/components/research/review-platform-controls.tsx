"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { checkPlatformReviews, refreshPlatformReviews, saveReviewProfiles } from "@/app/(dashboard)/reviews/actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const field = "w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Manual refresh with its cost; while tasks are pending it polls (free) every 20 s. */
export function ReviewsRefresh({ canEdit, estimate, pending }: { canEdit: boolean; estimate: string; pending: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => { const r = await checkPlatformReviews(); if (r.done) router.refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [pending, router]);
  if (!canEdit) return pending ? <p className="text-xs text-muted">Collecting reviews…</p> : null;
  return (
    <div className="space-y-1">
      <button className={btn2} disabled={busy} onClick={() => start(async () => {
        setMsg(null);
        const r = await refreshPlatformReviews();
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        router.refresh();
      })}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh all platforms <span className="opacity-70">({estimate})</span>
      </button>
      {pending && <p className="text-xs text-muted">Collecting reviews… this page updates by itself.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}

/** Owner editor for the listing link on each platform. */
export function ProfileLinksEditor({ canEdit, platforms, saved, defaults }: {
  canEdit: boolean; platforms: { key: string; label: string; example: string; access: string }[]; saved: Record<string, string>; defaults: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const init = useMemo(() => Object.fromEntries(platforms.map((p) => [p.key, saved[p.key] ?? defaults[p.key] ?? ""])), [platforms, saved, defaults]);
  const [v, setV] = useState<Record<string, string>>(init);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = platforms.some((p) => (v[p.key] ?? "") !== (saved[p.key] ?? ""));
  return (
    <fieldset disabled={!canEdit || busy} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {platforms.map((p) => (
          <label key={p.key} className="text-sm">
            <span className="flex items-center gap-2">{p.label}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${p.access === "api" ? "bg-positive/10 text-positive" : p.access === "credentials" ? "bg-accent/10 text-accent" : "bg-surface-muted text-muted"}`}>
                {p.access === "api" ? "auto" : p.access === "credentials" ? "needs key" : "link only"}</span></span>
            <input className={`${field} mt-1`} value={v[p.key] ?? ""} placeholder={p.example} onChange={(e) => setV({ ...v, [p.key]: e.target.value })} />
          </label>
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn} disabled={busy || (!dirty && Object.keys(saved).length > 0)} onClick={() => start(async () => {
            const r = await saveReviewProfiles(v);
            setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })}>{busy && <Loader2 className="size-4 animate-spin" />} Save links</button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
        </div>
      )}
    </fieldset>
  );
}

/** Latest reviews across platforms with a platform filter. */
export function ReviewFeed({ items, platforms }: {
  items: { platform: string; label: string; rating: number | null; author: string | null; date: string | null; title: string | null; text: string | null; reply: string | null; url: string | null }[];
  platforms: { key: string; label: string }[];
}) {
  const [f, setF] = useState("all");
  const [n, setN] = useState(15);
  const list = items.filter((i) => f === "all" || i.platform === f);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by platform">
        {[{ key: "all", label: "All" }, ...platforms].map((p) => (
          <button key={p.key} role="tab" aria-selected={f === p.key} onClick={() => { setF(p.key); setN(15); }}
            className={`rounded-full border px-2.5 py-1 text-xs ${f === p.key ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface-muted"}`}>{p.label}</button>
        ))}
      </div>
      <ul className="divide-y divide-border">
        {list.slice(0, n).map((r, i) => (
          <li key={i} className="py-3 text-sm">
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span className="font-medium text-foreground">{r.author ?? "Anonymous"}</span>
              <span aria-label={`${r.rating ?? "?"} out of 5`} className="text-amber-500">{"★".repeat(Math.round(r.rating ?? 0))}<span className="text-border">{"★".repeat(5 - Math.round(r.rating ?? 0))}</span></span>
              <span>{r.date ?? ""}</span><span className="rounded bg-surface-muted px-1.5">{r.label}</span>
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="underline">open</a>}
            </p>
            {r.title && <p className="mt-1 font-medium">{r.title}</p>}
            {r.text ? <p className="mt-1 whitespace-pre-line">{r.text}</p> : <p className="mt-1 text-xs italic text-muted">Rating only, no text.</p>}
            {r.reply && <p className="mt-2 border-l-2 border-accent/50 pl-3 text-xs text-muted"><span className="font-medium text-foreground">Owner reply: </span>{r.reply}</p>}
          </li>
        ))}
        {list.length === 0 && <li className="py-3 text-sm text-muted">No reviews collected for this platform yet.</li>}
      </ul>
      {list.length > n && <button className={`${btn2} mt-2`} onClick={() => setN(n + 15)}>Show more ({list.length - n} left)</button>}
    </div>
  );
}
