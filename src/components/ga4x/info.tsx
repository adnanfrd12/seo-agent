"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info as InfoIcon, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The ⓘ next to a card or tile title: what the number means, how it's worked out and where it comes from. */
export function Info({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block align-middle">
      <button type="button" aria-label={`About ${title}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="ml-1.5 grid size-4 place-items-center rounded-full border border-border text-[10px] text-muted hover:border-foreground hover:text-foreground">
        <InfoIcon className="size-2.5" aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label={title} className="absolute left-0 top-6 z-30 w-[min(22rem,80vw)] rounded-lg border border-border bg-surface p-3 text-left text-[13px] font-normal leading-relaxed shadow-lg">
          <div className="mb-1 flex items-start justify-between gap-2"><b>{title}</b><button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-muted hover:text-foreground"><X className="size-3.5" /></button></div>
          <p className="whitespace-pre-line text-secondary">{text}</p>
        </div>
      )}
    </div>
  );
}

/** Reads GA4 again now (otherwise it refreshes by itself once a day). */
export function SyncButton({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => start(async () => { const r = await action(); setMsg(r); router.refresh(); })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {pending ? "Reading GA4…" : "Sync now"}
      </button>
      {msg && <span role="status" className={cn("text-xs", msg.ok ? "text-positive" : "text-negative")}>{msg.message}</span>}
    </div>
  );
}

/** Copies text (a tag, a task list) to the clipboard. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ } }}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted">{done ? "Copied" : label}</button>
  );
}

/** Downloads text as a file (e.g. the Tag Manager container to import). */
export function DownloadButton({ text, filename, label }: { text: string; filename: string; label: string }) {
  return (
    <a href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`} download={filename}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-surface-muted">{label}</a>
  );
}

/** Lead type of one event (saved per client; "Automatic" goes back to detection by name). */
export function LeadTypeSelect({ event, value, auto, options, action, disabled }: { event: string; value: string; auto: boolean; options: string[]; disabled?: boolean; action: (event: string, type: string | null) => Promise<{ ok: boolean; message: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select disabled={disabled || pending} value={auto ? "__auto" : value} aria-label={`Lead type of ${event}`}
      onChange={(e) => { const v = e.target.value; start(async () => { await action(event, v === "__auto" ? null : v); router.refresh(); }); }}
      className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs disabled:opacity-60">
      <option value="__auto">Automatic{auto ? ` (${value || "not a lead"})` : ""}</option>
      <option value="">Not a lead</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** The cities the business serves, one per line. */
export function ServiceAreaForm({ initial, source, action, disabled }: { initial: string[]; source: string; disabled?: boolean; action: (text: string) => Promise<{ ok: boolean; message: string }> }) {
  const router = useRouter();
  const [text, setText] = useState(initial.join("\n"));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} rows={6} aria-label="Service area cities"
        className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || pending} onClick={() => start(async () => { const r = await action(text); setMsg(r.message); router.refresh(); })}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-60">{pending ? "Saving…" : "Save service area"}</button>
        <button type="button" disabled={disabled || pending} onClick={() => start(async () => { const r = await action(""); setMsg(r.message); router.refresh(); })}
          className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-60">Use automatic</button>
        <span className="text-xs text-muted">Now: {source}</span>
        {msg && <span role="status" className="text-xs text-positive">{msg}</span>}
      </div>
    </div>
  );
}

/** Re-reads the page every `seconds` while it's open (the Realtime screen). */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t); }, [router, seconds]);
  return null;
}
