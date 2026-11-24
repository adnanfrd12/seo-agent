"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Send, Sparkles } from "lucide-react";
import { startQuickWins } from "@/app/(dashboard)/ai-quick-wins/actions";
import { SOURCES } from "@/lib/aiqw/types";
import { RunSteps, useRun } from "./generate-panel";

/** "✨ Quick wins for this screen": runs only this screen's rules (fast, cheap); the list below refreshes when done. */
export function ScreenRunButton({ screen, canEdit }: { screen: string; canEdit: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const onEnd = useCallback(() => router.refresh(), [router]);
  const { run, setRunId } = useRun(null, onEnd);
  const running = run?.status === "running";
  return (
    <div className="space-y-2">
      <button type="button" disabled={!canEdit || running} onClick={async () => { setErr(null); const r = await startQuickWins({ scope: { kind: "screen", screen }, depth: "standard", sources: SOURCES }); if (r.ok) setRunId(r.runId); else setErr(r.error); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50">
        {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />} Quick wins for this screen
      </button>
      {!canEdit && <p className="text-xs text-muted">Owners and admins can run it.</p>}
      {err && <p role="alert" className="text-xs text-negative">{err}</p>}
      {run && run.status !== "done" && <RunSteps run={run} />}
    </div>
  );
}

/** Bold (**x**) inside one line of Claude's answer. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}</>;
}
/** A small Markdown subset for answers: paragraphs, "- " and "1. " lists, bold. */
function Answer({ text }: { text: string }) {
  const blocks: { kind: "p" | "ul" | "ol"; lines: string[] }[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trimEnd();
    const kind = /^\s*[-*] /.test(line) ? "ul" : /^\s*\d+[.)] /.test(line) ? "ol" : "p";
    const body = line.replace(/^\s*([-*]|\d+[.)]) /, "");
    const last = blocks[blocks.length - 1];
    if (!line.trim()) { blocks.push({ kind: "p", lines: [] }); continue; }
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(body); else blocks.push({ kind, lines: [body] });
  }
  return (
    <div className="space-y-2">
      {blocks.filter((b) => b.lines.length).map((b, i) => b.kind === "p"
        ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j ? <br /> : null}<Inline text={l} /></span>)}</p>
        : b.kind === "ul" ? <ul key={i} className="list-disc space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}><Inline text={l} /></li>)}</ul>
        : <ol key={i} className="list-decimal space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}><Inline text={l} /></li>)}</ol>)}
    </div>
  );
}

/** "💬 Ask Claude": the question goes to the server with this screen's data; the answer streams in. */
export function AskClaude({ screen }: { screen: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [used, setUsed] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3 || busy) return;
    setBusy(true); setAnswer(""); setErr(null); setUsed([]);
    try {
      const res = await fetch("/api/ai/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screen, question: q }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Claude couldn't answer."); return; }
      try { setUsed(JSON.parse(decodeURIComponent(res.headers.get("x-data-used") ?? "%5B%5D"))); } catch { /* list is optional */ }
      const reader = res.body.getReader(), dec = new TextDecoder();
      for (;;) { const { done, value } = await reader.read(); if (done) break; setAnswer((a) => a + dec.decode(value, { stream: true })); }
    } catch { setErr("Couldn't reach the server."); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <form onSubmit={ask} className="flex gap-2">
        <label htmlFor={`ask-${screen}`} className="sr-only">Ask Claude about this screen</label>
        <input id={`ask-${screen}`} value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="e.g. Why did clicks drop last month?" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        <button type="submit" disabled={busy || q.trim().length < 3} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Ask
        </button>
      </form>
      {err && <p role="alert" className="text-sm text-negative">{err}</p>}
      {(answer || busy) && (
        <div className="rounded-md border border-border bg-background p-3 text-sm" aria-live="polite">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted"><MessageSquare className="size-3.5" /> Claude</p>
          {answer ? <Answer text={answer} /> : <p className="text-muted">Thinking…</p>}
          {used.length > 0 && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Data sent with the question ({used.length})</summary><ul className="mt-1 list-disc pl-4">{used.map((u) => <li key={u}>{u}</li>)}</ul></details>}
        </div>
      )}
    </div>
  );
}
