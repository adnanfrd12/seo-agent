"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, X } from "lucide-react";
import { addAiPrompts, removeAiPrompt, runAiVisibilityNow, setAiEngines, setAiSearch } from "@/app/(dashboard)/ai-visibility/actions";
import { addRankKeywords, checkRanksNow, removeRankKeyword } from "@/app/(dashboard)/rank-tracking/actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const field = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
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

/** Small "x" next to a tracked keyword or question. */
export function RemoveButton({ kind, id, label }: { kind: "rank" | "ai"; id: string; label: string }) {
  const { pending, run } = useRun();
  return (
    <button aria-label={`Stop tracking ${label}`} title="Stop tracking" disabled={pending} onClick={() => run(() => (kind === "rank" ? removeRankKeyword(id) : removeAiPrompt(id)))}
      className="rounded p-1 text-muted hover:bg-surface-muted hover:text-negative disabled:opacity-50">
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
    </button>
  );
}

export function RankControls({ canEdit, count, due, suggestions, estimate }: { canEdit: boolean; count: number; due: number; suggestions: string[]; estimate: string }) {
  const { pending, run, note } = useRun();
  const [text, setText] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile" | "both">("desktop");
  if (!canEdit) return <p className="text-xs text-muted">Only owners and admins can change tracked keywords.</p>;
  return (
    <div className="space-y-3 rounded-[10px] border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-sm">Keywords to track <span className="text-muted">(one per line)</span>
          <textarea className={`${field} mt-1 min-h-20`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"led signs houston\nneon sign maker near me"} />
        </label>
        <div className="space-y-2">
          <label className="block text-sm">Device
            <select className={`${field} mt-1`} value={device} onChange={(e) => setDevice(e.target.value as "desktop" | "mobile" | "both")}><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="both">Desktop + mobile</option></select>
          </label>
          <button className={btn} disabled={pending || !text.trim()} onClick={() => run(() => addRankKeywords(text, device), (r) => { if (r.ok) setText(""); })}>
            {pending && <Loader2 className="size-4 animate-spin" />} Add keywords
          </button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="text-xs text-muted">
          Suggested from keywords your site already ranks for:{" "}
          {suggestions.map((s) => <button key={s} className="mr-1.5 mt-1 rounded-full border border-border px-2 py-0.5 hover:bg-surface-muted" onClick={() => setText((t) => (t.split("\n").includes(s) ? t : `${t}${t && !t.endsWith("\n") ? "\n" : ""}${s}`))}>+ {s}</button>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button className={btn2} disabled={pending || count === 0} onClick={() => run(() => checkRanksNow(due === 0))}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {due > 0 ? `Check ${due} keyword${due > 1 ? "s" : ""} now` : "Re-check all now"} <span className="opacity-70">(≈{estimate})</span>
        </button>
        <span className="text-xs text-muted">Positions refresh weekly on their own for active clients. Each check looks at Google&apos;s top 30 results.</span>
      </div>
      {note}
    </div>
  );
}

const ENGINE_LABELS: { key: string; label: string; cost: string }[] = [
  { key: "chatgpt", label: "ChatGPT", cost: "3¢" }, { key: "perplexity", label: "Perplexity", cost: "1¢" },
  { key: "gemini", label: "Gemini", cost: "4¢" }, { key: "ai_mode", label: "Google AI Mode", cost: "under 1¢" },
  { key: "claude", label: "Claude", cost: "5¢, your Anthropic key" },
];

export function AiControls({ canEdit, count, due, search, suggestions, estimate, engines }: { canEdit: boolean; count: number; due: number; search: boolean; suggestions: string[]; estimate: string; engines: string[] }) {
  const { pending, run, note } = useRun();
  const [text, setText] = useState("");
  const toggle = (k: string, on: boolean) => run(() => setAiEngines(on ? [...engines, k] : engines.filter((e) => e !== k)));
  if (!canEdit) return <p className="text-xs text-muted">Only owners and admins can change tracked questions.</p>;
  return (
    <div className="space-y-3 rounded-[10px] border border-border bg-surface p-4">
      <label className="block text-sm">Questions customers might ask an AI assistant <span className="text-muted">(one per line, up to 15)</span>
        <textarea className={`${field} mt-1 min-h-24`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Who are the best LED sign companies in Houston?\nWhere can I get a custom neon sign made?"} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={pending || !text.trim()} onClick={() => run(() => addAiPrompts(text), (r) => { if (r.ok) setText(""); })}>
          {pending && <Loader2 className="size-4 animate-spin" />} Add questions
        </button>
        <label className="ml-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={search} disabled={pending} onChange={(e) => run(() => setAiSearch(e.target.checked))} />
          Claude uses live web search <span className="text-muted">(off = Claude&apos;s own knowledge, cheaper)</span>
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Assistants asked</legend>
        {ENGINE_LABELS.map((e) => (
          <label key={e.key} className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--accent)]" checked={engines.includes(e.key)} disabled={pending} onChange={(ev) => toggle(e.key, ev.target.checked)} />
            {e.label} <span className="text-xs text-muted">({e.cost})</span>
          </label>
        ))}
      </fieldset>
      {suggestions.length > 0 && (
        <div className="text-xs text-muted">
          Suggested from your top keywords:{" "}
          {suggestions.map((s) => <button key={s} className="mr-1.5 mt-1 rounded-full border border-border px-2 py-0.5 text-left hover:bg-surface-muted" onClick={() => setText((t) => (t.split("\n").includes(s) ? t : `${t}${t && !t.endsWith("\n") ? "\n" : ""}${s}`))}>+ {s}</button>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button className={btn2} disabled={pending || count === 0} onClick={() => run(() => runAiVisibilityNow(due === 0))}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {due > 0 ? `Check ${due} question${due > 1 ? "s" : ""} now` : "Re-check all now"} <span className="opacity-70">(≈{estimate})</span>
        </button>
        <span className="text-xs text-muted">Runs automatically every week. ChatGPT, Perplexity, Gemini and Google AI Mode answer through DataForSEO (inside the daily API budget); Claude uses your Anthropic key; Claude Sonnet 5.5 reads every answer for brands and sentiment.</span>
      </div>
      {note}
    </div>
  );
}
