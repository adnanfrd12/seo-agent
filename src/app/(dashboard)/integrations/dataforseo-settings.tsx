"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveDfsSettings } from "../research-actions";

const field = "w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Daily spend limit and the automatic-refresh switch (agency-wide, saved in the database). */
export function DataForSeoSettings({ dailyBudget, autoRefresh, defaultBudget }: { dailyBudget: number; autoRefresh: boolean; defaultBudget: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [limit, setLimit] = useState(String(dailyBudget));
  const [auto, setAuto] = useState(autoRefresh);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const value = Number(limit);
  const valid = Number.isFinite(value) && value >= 0.1 && value <= 100;
  const changed = value !== dailyBudget || auto !== autoRefresh;

  const save = () => start(async () => {
    const r = await saveDfsSettings({ dailyBudget: value, autoRefresh: auto });
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Spending limit</p>
      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="text-sm">Daily limit (USD)
          <span className="mt-1 flex items-center gap-1">
            <span className="text-muted">$</span>
            <input type="number" inputMode="decimal" min={0.1} max={100} step={0.1} className={field} value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!valid} />
          </span>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Automatic weekly refresh
        </label>
        <button type="button" disabled={!changed || !valid || pending} onClick={save}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
          {pending && <Loader2 className="size-4 animate-spin" />} Save
        </button>
        {value !== defaultBudget && <button type="button" className="pb-1.5 text-xs text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground" onClick={() => setLimit(String(defaultBudget))}>Reset to ${defaultBudget.toFixed(2)}</button>}
      </div>
      {!valid && <p role="alert" className="mt-1 text-xs text-negative">Enter an amount between $0.10 and $100.</p>}
      <p className="mt-2 text-xs text-muted">
        No call is made once today&apos;s total reaches this limit (it resets at midnight UTC). Scheduled refreshes use at most 60% of it, and one client at most 40%.
        Applies to every client, since they share one DataForSEO account.
      </p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}
