"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { explainIssueAction } from "@/app/(dashboard)/issue-actions";
import { Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { Markdown } from "@/components/nova/markdown";
import type { IssueFix } from "@/lib/ai/issue-explain";
import { cn } from "@/lib/utils";

/**
 * Makes an error or warning clickable: a popup with the full item and Claude's explanation and fix for it (stored
 * ones show at once; otherwise written for owners and admins when they open it). `children` is what's clicked.
 */
export function ExplainIssue({ title, detail = "", href, className, children }: {
  title: string; detail?: string; href?: string; className?: string; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState<IssueFix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = (regenerate = false) => start(async () => {
    setErr(null);
    const r = await explainIssueAction({ path, title, detail }, regenerate);
    if (r.ok) setFix(r.fix); else setErr(r.error);
  });

  return (
    <>
      <button type="button" className={cn("block w-full text-left", className)} title="Show details and how to fix it"
        onClick={() => { setOpen(true); if (!fix) load(); }}>
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto text-sm text-foreground">
          {detail && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Details</h3>
              <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-surface-sunken p-3">{detail}</p>
            </section>
          )}
          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Sparkles className="size-3.5" aria-hidden /> AI explanation and solution</h3>
            {fix ? (
              <div className="min-w-0"><Markdown text={fix.text} /><p className="mt-2 text-xs text-muted">Written {fix.at.slice(0, 10)} · ${fix.cost.toFixed(3)} · stored, so it isn&apos;t paid again until this item changes.</p></div>
            ) : pending ? (
              <p className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Claude is reading this page&apos;s data…</p>
            ) : err ? <p role="alert" className="text-negative">{err}</p> : null}
          </section>
        </DialogBody>
        <DialogFooter>
          {href && <Link href={href} className={dialogBtn.secondary} onClick={() => setOpen(false)}>Open the related page</Link>}
          {fix && (
            <button type="button" className={dialogBtn.secondary} disabled={pending} onClick={() => load(true)}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} Write again
            </button>
          )}
          <button type="button" className={dialogBtn.primary} data-autofocus onClick={() => setOpen(false)}>Close</button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
