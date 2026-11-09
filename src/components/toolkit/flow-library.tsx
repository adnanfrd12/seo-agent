"use client";

import { useMemo, useState } from "react";
import { CopyText } from "@/components/toolkit/text-file";
import { cn } from "@/lib/utils";

export interface FlowPrompt { slug: string; stage: string; title: string; use: string; prompt: string }
const STAGES = ["all", "find", "leverage", "optimize", "win", "local"] as const;

/** Filterable FLOW prompt list; "Fill in client" swaps the placeholders for this client's details. */
export function FlowLibrary({ prompts, business, context }: { prompts: FlowPrompt[]; business: string; context: string }) {
  const [stage, setStage] = useState<(typeof STAGES)[number]>("all");
  const [q, setQ] = useState("");
  const [fill, setFill] = useState(true);
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, s === "all" ? prompts.length : prompts.filter((p) => p.stage === s).length])), [prompts]);
  const list = prompts.filter((p) => (stage === "all" || p.stage === stage) && (!q || `${p.title} ${p.use} ${p.prompt}`.toLowerCase().includes(q.toLowerCase())));
  const text = (p: FlowPrompt) => (fill ? `${p.prompt.replaceAll("[BUSINESS OR ASSET]", business)}\n\n${context}` : p.prompt);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="FLOW stage">
          {STAGES.map((s) => (
            <button key={s} role="tab" aria-selected={stage === s} onClick={() => setStage(s)}
              className={cn("rounded-lg px-2.5 py-1 text-sm capitalize", stage === s ? "bg-accent text-accent-foreground" : "border border-border hover:bg-surface-muted")}>
              {s} <span className="opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts" aria-label="Search prompts" className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm sm:max-w-xs" />
        <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Fill in client context</label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p) => (
          <details key={`${p.stage}/${p.slug}`} className="group min-w-0 rounded-[10px] border border-border bg-surface p-4">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{p.title.replace(/^Prompt:\s*/i, "")}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.use}</p>
              </div>
              <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 text-xs capitalize">{p.stage}</span>
            </summary>
            <div className="mt-3 flex justify-end"><CopyText text={text(p)} label="Copy prompt" /></div>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-3 text-xs">{text(p)}</pre>
          </details>
        ))}
        {list.length === 0 && <p className="text-sm text-muted">No prompt matches.</p>}
      </div>
    </div>
  );
}
