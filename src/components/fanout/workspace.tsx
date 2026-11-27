"use client";

import { useState } from "react";
import { ClipboardPaste, FlaskConical, Radar } from "lucide-react";
import type { PageOption } from "@/lib/fanout/pages";
import { cn } from "@/lib/utils";
import { LiveFanout, type LiveBatchView } from "./live";
import { FanoutRunner } from "./runner";

type Method = "simulate" | "ask" | "paste";
type Platform = "chatgpt" | "claude" | "gemini" | "grok" | "perplexity";

const METHODS: { key: Method; label: string; hint: string; icon: typeof Radar }[] = [
  { key: "simulate", label: "Simulate fan-out", hint: "Claude predicts the sub-queries for keywords or your pages, with coverage and search volume", icon: FlaskConical },
  { key: "ask", label: "Ask the AIs", hint: "The searches ChatGPT, Claude, Gemini, Grok and Perplexity really run (API keys)", icon: Radar },
  { key: "paste", label: "Paste from ChatGPT", hint: "Free: paste ChatGPT's network Response and its searches are pulled out", icon: ClipboardPaste },
];

/**
 * Fan-Out Queries in one place: pick how to get queries (simulated, real from the AI platforms, or pasted from
 * ChatGPT), then see the results of either kind below. Every existing control and result is kept as it was.
 */
export function FanoutWorkspace({ canEdit, simReady, pages, domain, liveReady, liveTableReady, batches, simResults, simCount }: {
  canEdit: boolean; simReady: boolean; pages: PageOption[]; domain: string;
  liveReady: Record<Platform, boolean>; liveTableReady: boolean; batches: LiveBatchView[];
  /** the simulated runs list and the open run (rendered on the server) */
  simResults: React.ReactNode; simCount: number;
}) {
  const [method, setMethod] = useState<Method>("simulate");
  const [view, setView] = useState<"sim" | "real">("sim");
  const pick = (m: Method) => { setMethod(m); setView(m === "simulate" ? "sim" : "real"); };
  const live = (show: "ask" | "paste" | "results") => <LiveFanout canEdit={canEdit} ready={liveReady} tableReady={liveTableReady} batches={batches} domain={domain} show={show} />;

  return (
    <div className="space-y-5">
      <section aria-label="Get fan-out queries" className="rounded-[10px] border border-border bg-surface">
        <div role="tablist" aria-label="Method" className="grid gap-px overflow-hidden rounded-t-[10px] border-b border-border bg-border sm:grid-cols-3">
          {METHODS.map((m) => (
            <button key={m.key} role="tab" type="button" aria-selected={method === m.key} onClick={() => pick(m.key)}
              className={cn("flex items-start gap-2.5 px-4 py-3 text-left transition", method === m.key ? "bg-surface" : "bg-surface-sunken hover:bg-surface-muted")}>
              <m.icon className={cn("mt-0.5 size-4 shrink-0", method === m.key ? "text-accent" : "text-muted")} aria-hidden />
              <span className="min-w-0">
                <span className={cn("block text-sm font-semibold", method === m.key ? "text-foreground" : "text-secondary")}>{m.label}</span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="p-4 sm:p-5">
          {!canEdit ? <p className="text-sm text-muted">Only owners and admins can run fan-out queries. Everyone can view the results below.</p>
            : method === "simulate" ? (simReady ? <FanoutRunner canEdit pages={pages} domain={domain} embedded /> : <p className="text-sm text-warn">Fan-out storage isn&apos;t set up yet: apply migration 20261128000034_fanout.sql.</p>)
              : live(method)}
        </div>
      </section>

      <section aria-label="Fan-out results">
        <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Results">
          {([["sim", `Simulated runs (${simCount})`], ["real", `Real AI queries (${batches.length})`]] as const).map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={view === k} onClick={() => setView(k)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", view === k ? "bg-foreground text-background" : "text-secondary hover:bg-surface-muted")}>{l}</button>
          ))}
        </div>
        {view === "sim" ? simResults : <div className="rounded-[10px] border border-border bg-surface p-4 sm:p-5">{live("results")}</div>}
      </section>
    </div>
  );
}
