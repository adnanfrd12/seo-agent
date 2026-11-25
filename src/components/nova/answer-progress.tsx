"use client";

import { useEffect, useState } from "react";

/** "12s", "1:05". */
export const fmtElapsed = (s: number) => (s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

function useElapsed(startedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  return Math.max(0, (now - startedAt) / 1000);
}

/** Four dots that pulse in turn and slowly rotate (static when the user prefers reduced motion). */
export function NovaDots({ className }: { className?: string }) {
  return <span className={`nova-dots ${className ?? ""}`} aria-hidden><span /><span /><span /><span /></span>;
}

/** While Nova works: animated dots, what it is doing right now, and a running timer. */
export function WorkingIndicator({ startedAt, label }: { startedAt: number; label: string }) {
  const elapsed = useElapsed(startedAt);
  return (
    <p className="flex items-center gap-2.5 text-[13px] text-secondary" role="status" aria-live="polite">
      <NovaDots />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-faint" aria-label={`${Math.floor(elapsed)} seconds`}>{fmtElapsed(elapsed)}</span>
    </p>
  );
}

/**
 * A bar for long jobs with a known typical duration (writing a monthly strategy, about two minutes). Linear up to
 * 85% of the estimate, then easing towards 97%: it never claims to be finished before it is.
 */
export function StepProgress({ startedAt, expectedS, label }: { startedAt: number; expectedS: number; label?: string }) {
  const elapsed = useElapsed(startedAt);
  const ratio = elapsed / expectedS;
  const pct = Math.min(97, ratio < 0.85 ? ratio * 100 : 85 + 12 * (1 - Math.exp(-(ratio - 0.85) * 4)));
  const left = expectedS - elapsed;
  const note = left > 60 ? `about ${Math.round(left / 60)} min left` : left > 10 ? `about ${Math.round(left / 5) * 5}s left` : "almost done";
  return (
    <div className="space-y-1" role="progressbar" aria-label={label ?? "Progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={`${fmtElapsed(elapsed)} elapsed, ${elapsed > expectedS + 10 ? "taking a little longer" : note}`}>
      <div className="h-1 overflow-hidden rounded-full bg-surface-muted"><div className="nova-progress h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(3, pct)}%` }} /></div>
      <p className="flex justify-between text-[11px] tabular-nums text-faint"><span>{label}</span><span>{fmtElapsed(elapsed)} · {elapsed > expectedS + 10 ? "taking a little longer" : note}</span></p>
    </div>
  );
}

/** Under a finished answer: how long it took (or that it was stopped). */
export function AnswerTime({ ms, stopped }: { ms: number; stopped?: boolean }) {
  return <p className="text-[11px] text-faint">{stopped ? `Stopped after ${fmtElapsed(ms / 1000)}` : `Answered in ${fmtElapsed(ms / 1000)}`}</p>;
}
