import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, CircleDashed, CircleHelp, XCircle } from "lucide-react";
import { ExplainIssue } from "@/components/dashboard/explain-issue";
import { cn } from "@/lib/utils";

/**
 * Building blocks in the SEOSignalX dashboard style: soft tinted cards, a colored score ring per check,
 * small status pills (DONE / NOT RUN) and check lists with pass / fail / unavailable markers.
 */
export type Tone = "green" | "blue" | "orange" | "red" | "gray";

const TONE: Record<Tone, { ring: string; tint: string; text: string }> = {
  green: { ring: "#10b981", tint: "from-emerald-500/[0.07]", text: "text-emerald-600 dark:text-emerald-400" },
  blue: { ring: "#3b82f6", tint: "from-blue-500/[0.07]", text: "text-blue-600 dark:text-blue-400" },
  orange: { ring: "#f97316", tint: "from-orange-500/[0.07]", text: "text-orange-600 dark:text-orange-400" },
  red: { ring: "#e11d48", tint: "from-rose-500/[0.07]", text: "text-rose-600 dark:text-rose-400" },
  gray: { ring: "#94a3b8", tint: "from-slate-500/[0.05]", text: "text-muted" },
};
export const toneFor = (pct: number | null): Tone => (pct == null ? "gray" : pct >= 90 ? "green" : pct >= 80 ? "blue" : pct >= 60 ? "orange" : "red");
export const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export function ScoreRing({ value, size = 56, tone }: { value: number | null; size?: number; tone?: Tone }) {
  const t = TONE[tone ?? toneFor(value)];
  const stroke = size < 48 ? 3 : 4;
  const r = size / 2 - stroke, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={value == null ? "Not available" : `${value}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-border" />
        {value != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.ring} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />}
      </svg>
      {/* text scales with the ring so "100%" fits inside even the small (36 px) rings */}
      <span className="absolute inset-0 grid place-items-center font-bold leading-none tabular-nums tracking-tight" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
        {value == null ? "- -" : <span>{value}<span style={{ fontSize: "0.7em" }}>%</span></span>}
      </span>
    </div>
  );
}

export function Pill({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  const cls: Record<Tone, string> = {
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    orange: "bg-orange-500/10 text-orange-700 dark:text-orange-300", red: "bg-rose-500/10 text-rose-700 dark:text-rose-300", gray: "bg-surface-muted text-muted",
  };
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls[tone])}>{children}</span>;
}

/** A dashboard score card: icon, title, one-line summary, status pill and score ring; links to its detail page. */
export function ScoreCard({ href, icon, title, summary, score, status }: { href?: string; icon: ReactNode; title: string; summary: string; score: number | null; status: "done" | "not run" }) {
  const tone = status === "done" ? toneFor(score) : "gray";
  const body = (
    <div className={cn("relative h-full overflow-hidden rounded-xl border border-border bg-gradient-to-br to-transparent bg-surface p-4 transition-shadow", TONE[tone].tint, href && "hover:shadow-md")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-surface ring-1 ring-border", TONE[tone].text)}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="truncate text-[11px] text-muted">{summary}</p>
        </div>
        {href && <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden />}
      </div>
      <div className="mt-5 flex items-end justify-between gap-2">
        <Pill tone={status === "done" ? "green" : "gray"}>{status === "done" ? "Done" : "Not run"}</Pill>
        <ScoreRing value={status === "done" ? score : null} tone={tone} />
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent">{body}</Link> : body;
}

export function Card({ title, sub, right, children, className }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-surface", className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3">
          <div className="min-w-0">{title && <h2 className="text-sm font-semibold">{title}</h2>}{sub && <p className="text-xs text-muted">{sub}</p>}</div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export type CheckStatus = "pass" | "clean" | "fail" | "found" | "warn" | "notfound" | "unavailable" | string | undefined;
export function statusMeta(s: CheckStatus): { icon: ReactNode; label: string; tone: Tone } {
  switch (s) {
    case "pass": case "clean": return { icon: <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />, label: s === "clean" ? "Clean" : "Pass", tone: "green" };
    case "fail": case "found": return { icon: <XCircle className="size-4 text-rose-500" aria-hidden />, label: s === "found" ? "Found" : "Fail", tone: "red" };
    case "warn": case "warning": return { icon: <CircleHelp className="size-4 text-orange-500" aria-hidden />, label: "Warning", tone: "orange" };
    case "notfound": return { icon: <CircleDashed className="size-4 text-faint" aria-hidden />, label: "Not found", tone: "gray" };
    default: return { icon: <CircleDashed className="size-4 text-faint" aria-hidden />, label: "Not available", tone: "gray" };
  }
}

/** One check: marker, name, description and an optional badge / extra lines. */
export function CheckRow({ status, name, desc, badge, extra, href }: { status: CheckStatus; name: string; desc?: string | null; badge?: ReactNode; extra?: ReactNode; href?: string | null }) {
  const m = statusMeta(status);
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-0.5" title={m.label}>{m.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* problems open a popup with the details and Claude's explanation and fix */}
          {m.tone === "red" || m.tone === "orange"
            ? <ExplainIssue title={`SEOSignalX: ${name}`} detail={[`Status: ${m.label}`, desc, typeof badge === "string" ? badge : null].filter(Boolean).join("\n")}
                className="w-auto text-sm font-medium underline decoration-border-strong decoration-dotted underline-offset-2 hover:text-accent">{name}</ExplainIssue>
            : <p className="text-sm font-medium">{name}</p>}
          <Pill tone={m.tone}>{m.label}</Pill>
          {badge && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary">{badge}</span>}
          {href && <a href={href} target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">How to fix</a>}
        </div>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
        {extra}
      </div>
    </li>
  );
}

/** A section of checks with its own pass bar. */
export function CheckSection({ title, passed, total, children }: { title: string; passed: number; total: number; children: ReactNode }) {
  const p = pctOf(passed, total);
  return (
    <Card title={title} right={
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="tabular-nums">{passed}/{total} passed</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full" style={{ width: `${p ?? 0}%`, background: TONE[toneFor(p)].ring }} /></span>
      </div>
    }>
      <ul className="divide-y divide-hairline">{children}</ul>
    </Card>
  );
}

/** Page header in the SEOSignalX style: title, the project and when SEOSignalX ran the audit. */
export function SxHeader({ title, description, project, analyzedAt, score, right }: { title: string; description: string; project?: string | null; analyzedAt?: string | null; score?: number | null; right?: ReactNode }) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-blue-500/[0.06] via-transparent to-fuchsia-500/[0.05] bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">SEOSignalX</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          {(project || analyzedAt) && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              {project && <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-foreground">{project}</span>}
              {analyzedAt && <span>Analyzed {new Date(analyzedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">{right}{score !== undefined && <ScoreRing value={score} size={72} />}</div>
      </div>
    </div>
  );
}

export const scoreLabel = (v: number | null) => (v == null ? "Not tested" : v >= 90 ? "Excellent" : v >= 80 ? "Good" : v >= 60 ? "Fair" : "Poor");

/** The big score block of an audit page: ring, label (Excellent / Good / Fair / Poor) and what it is based on. */
export function BigScore({ value, caption, detail }: { value: number | null; caption: string; detail: ReactNode }) {
  const tone = toneFor(value);
  return (
    <div className={cn("flex items-center gap-4 rounded-xl border border-border bg-gradient-to-br to-transparent bg-surface p-5", TONE[tone].tint)}>
      <ScoreRing value={value} size={96} />
      <div>
        <p className={cn("text-sm font-bold uppercase tracking-wider", TONE[tone].text)}>{scoreLabel(value)}</p>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{caption}</p>
        <p className="mt-1 text-sm">{detail}</p>
      </div>
    </div>
  );
}

/** A labelled horizontal bar (by-area / by-section lists). */
export function BarRow({ label, value, max, right }: { label: ReactNode; value: number; max: number; right: ReactNode }) {
  const p = pctOf(value, max) ?? 0;
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{label}</span><span className="shrink-0 text-xs text-muted">{right}</span></div>
      <span className="block h-1.5 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full" style={{ width: `${p}%`, background: TONE[toneFor(100 - p)].ring }} /></span>
    </li>
  );
}

/** Shown on an audit page when SEOSignalX has no saved result for it (or the client has no project). */
export function NoAudit({ label, reason }: { label: string; reason?: string | null }) {
  return <Empty title={`No ${label} audit from SEOSignalX`} body={reason ?? `Run the ${label} audit in SEOSignalX; the result appears here within a few hours (or press Sync on the SEOSignalX dashboard).`} />;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}
