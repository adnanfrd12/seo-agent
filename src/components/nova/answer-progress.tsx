"use client";

import { useEffect, useState } from "react";

/**
 * Progress while Nova works: elapsed time, an estimate of the time left and a bar.
 *
 * The estimate is honest about being one: Nova's answers have no fixed length, so the expected duration is set by
 * what it is doing (reading data, writing a whole monthly strategy, writing the answer) and the bar slows down as
 * it approaches the estimate instead of claiming to be finished. It only reaches 100% when the answer is done.
 */
export interface ProgressActivity { name: string; status: "running" | "done" | "failed"; startedAt?: number }

const STRATEGY_S = 150; // a full monthly strategy takes about two minutes
const fmt = (s: number) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const left = (s: number) => (s < 10 ? "a few seconds left" : s < 60 ? `about ${Math.round(s / 5) * 5}s left` : `about ${Math.round(s / 60)} min left`);

export function estimate(elapsed: number, activity: ProgressActivity[], hasText: boolean, now: number, startedAt: number) {
  const steps = activity.length;
  const strategy = activity.find((a) => a.name === "generate_monthly_strategy" && a.status === "running");
  let total: number;
  if (strategy) total = ((strategy.startedAt ?? now) - startedAt) / 1000 + STRATEGY_S;
  else if (hasText) total = Math.max(elapsed + 12, 25); // writing the answer: usually the last stretch
  else total = 40 + steps * 6;
  const remaining = Math.max(0, total - elapsed);
  // linear up to 85% of the estimate, then easing towards (never reaching) 97%
  const ratio = elapsed / total;
  const pct = ratio < 0.85 ? ratio * 100 : 85 + 12 * (1 - Math.exp(-(ratio - 0.85) * 4));
  return { pct: Math.min(97, Math.max(hasText ? 60 : 4, pct)), remaining, over: elapsed > total + 5 };
}

export function AnswerProgress({ startedAt, activity, hasText, label }: { startedAt: number; activity: ProgressActivity[]; hasText: boolean; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const { pct, remaining, over } = estimate(elapsed, activity, hasText, now, startedAt);
  return (
    <div className="space-y-1.5" role="progressbar" aria-label="Nova is answering" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={`${fmt(elapsed)} elapsed, ${over ? "taking longer than usual" : left(remaining)}`}>
      <div className="flex items-center justify-between gap-3 text-[11.5px] text-muted">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{fmt(elapsed)} · {over ? "taking a little longer" : left(remaining)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className="nova-progress h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** After the answer: how long it took. */
export function AnswerTime({ ms }: { ms: number }) {
  return <p className="text-[11px] text-faint">Answered in {fmt(ms / 1000)}</p>;
}
