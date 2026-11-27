"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { explainSecurityAi, runSecurityAuditNow } from "@/app/(dashboard)/technical-seo/actions";

type R = { ok: true; message: string } | { ok: false; error: string };

function useRun(fn: () => Promise<R>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    router.refresh();
  });
  return { pending, msg, run };
}

const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
  m && <p role={m.ok ? "status" : "alert"} className={`max-w-md break-words text-sm ${m.ok ? "text-positive" : "text-negative"}`}>{m.text}</p>;

/** Owner/admin button: runs the passive security audit now (free, ~15 seconds). */
export function SecurityRun({ canEdit, label = "Run security audit" }: { canEdit: boolean; label?: string }) {
  const { pending, msg, run } = useRun(runSecurityAuditNow);
  if (!canEdit) return null;
  return (
    <div className="space-y-1.5">
      <button className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60" disabled={pending} onClick={run}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} {label}
      </button>
      {pending ? <p className="text-xs text-muted">Running the checks (about 20 seconds), then Claude audits the results (about a minute).</p>
        : <p className="text-xs text-muted">Checks are free; Claude&apos;s audit counts toward the monthly Claude budget.</p>}
      <Msg m={msg} />
    </div>
  );
}

/** Owner/admin button: Claude writes a site-specific fix plan from the failing checks. */
export function SecurityAiButton({ canEdit, has }: { canEdit: boolean; has: boolean }) {
  const { pending, msg, run } = useRun(explainSecurityAi);
  if (!canEdit) return null;
  return (
    <div className="space-y-1.5">
      <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60" disabled={pending} onClick={run}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />} {has ? "Run Claude's audit again" : "Audit with Claude"}
      </button>
      {pending && <p className="text-xs text-muted">Claude is auditing the checks and the raw evidence. About a minute.</p>}
      <Msg m={msg} />
    </div>
  );
}
