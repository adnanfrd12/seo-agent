"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { generateAnalysis, setInsightStatus, setTaskStatus } from "@/app/(dashboard)/ai-actions";
import { cn } from "@/lib/utils";

/** Generate / Regenerate button. Runs can take a minute or two; the button stays busy until done. */
export function GenerateButton({ kind, start, end, label, disabled, disabledReason }: {
  kind: "insights" | "strategy"; start: string; end: string; label: string; disabled?: boolean; disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, start_] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        disabled={pending || disabled} title={disabled ? disabledReason : undefined}
        onClick={() => start_(async () => {
          setMsg(null);
          const r = await generateAnalysis(kind, start, end);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          router.refresh();
        })}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" aria-hidden />}
        {pending ? "Analysing… this can take a minute or two" : label}
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
    </div>
  );
}

const INSIGHT_ACTIONS = [
  { status: "approved", label: "Approve" },
  { status: "implemented", label: "Mark implemented" },
  { status: "dismissed", label: "Dismiss" },
  { status: "proposed", label: "Reset" },
] as const;

export function InsightActions({ id, status, canEdit }: { id: string; status: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {INSIGHT_ACTIONS.filter((a) => a.status !== status && !(a.status === "proposed" && status === "proposed")).map((a) => (
        <button key={a.status} disabled={pending}
          onClick={() => start(async () => { await setInsightStatus(id, a.status); router.refresh(); })}
          className={cn("rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
            a.status === "approved" || a.status === "implemented" ? "border-accent text-accent hover:bg-accent-soft" : "border-border hover:bg-surface-muted")}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function TaskStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Task status" value={status} disabled={pending}
      onChange={(e) => { const v = e.target.value; start(async () => { await setTaskStatus(id, v); router.refresh(); }); }}
      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium"
    >
      <option value="planned">Planned</option>
      <option value="in_progress">In progress</option>
      <option value="completed">Completed</option>
      <option value="skipped">Skipped</option>
    </select>
  );
}
