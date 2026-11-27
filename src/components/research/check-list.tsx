"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, CircleX, Info, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { explainTechnicalCheck } from "@/app/(dashboard)/technical-seo/actions";
import { Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { Markdown } from "@/components/nova/markdown";
import type { CheckFix } from "@/lib/technical/check-ai";
import type { Check } from "@/lib/technical/score";
import { cn } from "@/lib/utils";

const ICON = { pass: CheckCircle2, warn: CircleAlert, fail: CircleX, na: Info } as const;
const TONE = { pass: "text-positive", warn: "text-warn", fail: "text-negative", na: "text-muted" } as const;
const WORD = { pass: "Passed", warn: "Warning", fail: "Failed", na: "Not measured" } as const;

/**
 * A category's checks. Each one opens a popup with the full result (exact error and evidence) and Claude's
 * explanation and fix for it: stored ones show at once, otherwise it's written when an owner or admin opens it.
 */
export function CheckList({ checks, fixes, canEdit }: { checks: (Check & { key: string })[]; fixes: Record<string, CheckFix>; canEdit: boolean }) {
  const [open, setOpen] = useState<(Check & { key: string }) | null>(null);
  const [known, setKnown] = useState(fixes);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = (c: Check & { key: string }, regenerate = false) => start(async () => {
    setErr(null);
    const r = await explainTechnicalCheck(c.id, regenerate);
    if (r.ok) setKnown((k) => ({ ...k, [c.key]: r.fix })); else setErr(r.error);
  });
  const show = (c: Check & { key: string }) => {
    setOpen(c); setErr(null);
    // only problems are explained automatically; a passing check can be asked about with the button
    if (!known[c.key] && c.status !== "pass" && c.status !== "na") load(c);
  };
  const fix = open ? known[open.key] : undefined;

  return (
    <>
      <ul className="space-y-1">
        {checks.map((x) => {
          const I = ICON[x.status];
          return (
            <li key={x.id}>
              <button type="button" onClick={() => show(x)}
                className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent">
                <I className={cn("mt-0.5 size-4 shrink-0", TONE[x.status])} aria-label={x.status} />
                <span className="min-w-0 flex-1"><span className="font-medium">{x.label}</span> <span className="break-words text-muted">{x.evidence}</span> <span className="text-xs text-faint">· {x.source}</span></span>
                <span className={cn("shrink-0 tabular-nums text-xs", x.deduct ? "font-semibold text-negative" : "text-faint")}>{x.deduct ? `−${x.deduct}` : x.status === "na" ? "n/a" : "0"}</span>
                <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-faint opacity-0 transition group-hover:opacity-100" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open?.label ?? ""}
        description={open ? <span className={TONE[open.status]}>{WORD[open.status]}{open.deduct ? ` · −${open.deduct} points` : ""} · {open.source}</span> : undefined}>
        {open && (
          <>
            <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto text-sm text-foreground">
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Result</h3>
                <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-surface-sunken p-3">{open.evidence || "No details recorded."}</p>
              </section>
              <section>
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Sparkles className="size-3.5" aria-hidden /> AI explanation and solution</h3>
                {fix ? (
                  <div className="min-w-0"><Markdown text={fix.text} /><p className="mt-2 text-xs text-muted">Written {fix.at.slice(0, 10)} · ${fix.cost.toFixed(3)} · stored, so it isn&apos;t paid again until this check&apos;s result changes.</p></div>
                ) : pending ? (
                  <p className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Claude is reading the data behind this check…</p>
                ) : err ? (
                  <p role="alert" className="text-negative">{err}</p>
                ) : (
                  <p className="text-muted">{canEdit ? "Ask Claude to explain this check and how to keep it this way." : "No AI explanation yet."}</p>
                )}
              </section>
            </DialogBody>
            <DialogFooter>
              {canEdit && (
                <button type="button" className={dialogBtn.secondary} disabled={pending} onClick={() => load(open, Boolean(fix))}>
                  {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : fix ? <RefreshCw className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                  {fix ? "Write again" : "Explain with AI"}
                </button>
              )}
              <button type="button" className={dialogBtn.primary} data-autofocus onClick={() => setOpen(null)}>Close</button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </>
  );
}
