"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { removeCompetitor, restoreCompetitor } from "@/app/(dashboard)/competitors/actions";

type R = { ok: true; message: string } | { ok: false; error: string };

/** Tracked competitors with a Remove button (confirmed) and the removed ones with Restore. Owner/admin only. */
export function TrackedCompetitors({ canEdit, tracked, removed }: { canEdit: boolean; tracked: string[]; removed: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (d: string, fn: () => Promise<R>) => { setBusy(d); start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    setBusy(null);
    if (r.ok) router.refresh();
  }); };

  return (
    <section aria-label="Tracked competitors" className="mt-6 rounded-[10px] border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Tracked competitors</h2>
      <p className="mb-3 text-xs text-muted">Removing a competitor stops tracking it, keeps it out of automatic picks and hides its data on this page. You can restore it any time.</p>
      <ul className="flex flex-wrap gap-2">
        {tracked.map((d) => (
          <li key={d} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted py-1 pl-3 pr-1 text-sm">
            {d}
            {canEdit && (
              <button type="button" aria-label={`Remove ${d}`} title="Remove competitor" disabled={pending}
                onClick={() => { if (confirm(`Remove ${d} from your competitors?\n\nIt stops being tracked, its data is hidden here and automatic picks won't add it back. You can restore it later.`)) run(d, () => removeCompetitor(d)); }}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-negative hover:bg-negative/10 disabled:opacity-60">
                {busy === d ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />} Remove
              </button>
            )}
          </li>
        ))}
        {tracked.length === 0 && <li className="text-xs text-muted">No competitors tracked.</li>}
      </ul>
      {removed.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">Removed</p>
          <ul className="flex flex-wrap gap-2">
            {removed.map((d) => (
              <li key={d} className="inline-flex items-center gap-2 rounded-full border border-dashed border-border py-1 pl-3 pr-1 text-xs text-muted">
                <span className="line-through">{d}</span>
                {canEdit && (
                  <button type="button" disabled={pending} onClick={() => run(d, () => restoreCompetitor(d))}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-surface-muted hover:text-foreground disabled:opacity-60">
                    {busy === d ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />} Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </section>
  );
}
