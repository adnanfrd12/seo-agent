import { CheckCircle2, CircleAlert, CircleHelp, CircleX } from "lucide-react";
import { lhColor, ScoreRing } from "@/components/charts/score-ring";
import { Markdown } from "@/components/nova/markdown";
import type { SecAi, SecAudit } from "@/lib/technical/security";
import type { SecCheck, SecStatus, Severity } from "@/lib/technical/security-scan";
import { cn } from "@/lib/utils";
import { SecurityAiButton, SecurityRun } from "./security-controls";

const SEV: Record<Severity, string> = { high: "bg-negative text-white", medium: "bg-warn/15 text-warn", low: "bg-surface-muted text-secondary", info: "bg-surface-muted text-muted" };
const STATUS_LABEL: Record<SecStatus, string> = { pass: "Pass", fail: "Fail", warn: "Warning", unknown: "Not checked" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function StatusIcon({ s }: { s: SecStatus }) {
  const I = s === "pass" ? CheckCircle2 : s === "warn" ? CircleAlert : s === "fail" ? CircleX : CircleHelp;
  return <I className={cn("mt-0.5 size-4 shrink-0", s === "pass" ? "text-positive" : s === "warn" ? "text-warn" : s === "fail" ? "text-negative" : "text-muted")} aria-label={STATUS_LABEL[s]} />;
}

function Fix({ c, wp }: { c: SecCheck; wp: boolean }) {
  const f = c.fix;
  return (
    <div className="min-w-0 rounded-lg bg-surface-muted/60 p-3 text-sm">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">How to fix</p>
      <ol className="list-decimal space-y-1 pl-5 text-secondary">{f.steps.map((s) => <li key={s} className="break-words">{s}</li>)}</ol>
      {wp && f.wordpress?.length ? (
        <>
          <p className="mb-1 mt-2.5 text-xs font-semibold uppercase tracking-wide text-muted">On WordPress</p>
          <ul className="list-disc space-y-1 pl-5 text-secondary">{f.wordpress.map((s) => <li key={s} className="break-words">{s}</li>)}</ul>
        </>
      ) : null}
      {f.code?.length ? (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-xs font-medium text-accent">Copy-paste config</summary>
          <div className="mt-2 space-y-2">
            {f.code.map((x) => (
              <div key={x.label}>
                <p className="mb-0.5 text-xs text-muted">{x.label}</p>
                <pre className="overflow-x-auto whitespace-pre rounded-md border border-hairline bg-surface p-2 font-mono text-[12px] leading-snug">{x.text}</pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Row({ c, wp, open }: { c: SecCheck; wp: boolean; open: boolean }) {
  return (
    <li className="grid gap-3 border-t border-hairline py-3.5 first:border-t-0 lg:grid-cols-2 lg:gap-5">
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <StatusIcon s={c.status} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              {c.title}
              <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize", SEV[c.severity])}>{c.severity}</span>
              <span className="text-xs font-normal text-muted">{c.group} · {STATUS_LABEL[c.status]}</span>
            </p>
            <p className="mt-1 break-words text-sm text-secondary">{c.evidence}</p>
            <p className="mt-1 text-xs text-muted">{c.why}</p>
          </div>
        </div>
      </div>
      {open && c.fix.steps.length > 0 ? <Fix c={c} wp={wp} /> : <div className="hidden lg:block" />}
    </li>
  );
}

/** Technical SEO → Security audit: score, counts by severity and every check with its evidence and the fix beside it. */
export function SecurityAuditSection({ audit, ai, canEdit }: { audit: SecAudit | null; ai: SecAi | null; canEdit: boolean }) {
  const head = (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">Security audit</h2>
        <p className="text-xs text-muted">Passive checks a browser could make: HTTPS, security headers, exposed files, {audit?.wordpress ? "WordPress, " : ""}email DNS. Re-checked monthly.</p>
      </div>
      <SecurityRun canEdit={canEdit} label={audit ? "Run security audit" : "Run security audit now"} />
    </div>
  );
  if (!audit) return <section id="security" aria-label="Security audit" className="mt-6 scroll-mt-20 rounded-[10px] border border-border bg-surface p-5">{head}<p className="text-sm text-muted">Not run yet. It runs on its own within a day of adding a client{canEdit ? ", or run it now" : ""}.</p></section>;
  if (audit.error && !audit.checks.length) return <section id="security" aria-label="Security audit" className="mt-6 scroll-mt-20 rounded-[10px] border border-border bg-surface p-5">{head}<p className="text-sm text-negative">{audit.error}</p><p className="mt-1 text-xs text-muted">Tried {day(audit.checkedAt)}.</p></section>;

  const issues = audit.checks.filter((c) => c.status === "fail" || c.status === "warn");
  const rest = audit.checks.filter((c) => c.status === "pass" || c.status === "unknown");
  const prev = audit.history.slice(1, 6);
  return (
    <section id="security" aria-label="Security audit" className="mt-6 scroll-mt-20 rounded-[10px] border border-border bg-surface p-5">
      {head}
      <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-hairline p-4 text-center">
          <div className="[&>div]:w-auto"><ScoreRing score={audit.score} label="Security score" size={112} /></div>
          <p className="text-xs text-muted">{audit.passed} of {audit.total} checks pass</p>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {(["high", "medium", "low", "info"] as const).map((s) => <span key={s} className={cn("rounded-md px-2 py-0.5 font-medium capitalize", SEV[s])}>{audit.counts[s]} {s}</span>)}
          </div>
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">{audit.finalUrl ?? audit.domain}</span> · checked {day(audit.checkedAt)} · {audit.wordpress ? `WordPress${audit.wpVersion ? ` ${audit.wpVersion}` : ""}` : "not WordPress"}{audit.server ? ` · ${audit.server}` : ""} · {audit.requests} requests
          </p>
          {prev.length > 0 && (
            <p className="text-xs text-muted">Earlier: {prev.map((h) => <span key={h.at} className="mr-2 whitespace-nowrap"><span className="font-semibold tabular-nums" style={{ color: lhColor(h.score) }}>{h.score}</span> {day(h.at)}</span>)}</p>
          )}
          {issues.length > 0 && <SecurityAiButton canEdit={canEdit} has={Boolean(ai)} />}
        </div>
      </div>

      {ai && (
        <details className="mt-4 rounded-lg border border-hairline p-4" open>
          <summary className="cursor-pointer text-sm font-semibold">AI fix plan <span className="font-normal text-muted">· {day(ai.at)}{ai.auditAt !== audit.checkedAt ? " · written for an earlier audit" : ""}</span></summary>
          <div className="mt-3 min-w-0"><Markdown text={ai.text} /></div>
        </details>
      )}

      <h3 className="mb-1 mt-5 text-sm font-semibold">{issues.length ? `Issues (${issues.length})` : "No issues found"}</h3>
      {issues.length > 0 && <ul>{issues.map((c) => <Row key={c.id} c={c} wp={audit.wordpress} open />)}</ul>}
      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-secondary">Passed and not checked ({rest.length})</summary>
          <ul className="mt-1">{rest.map((c) => <Row key={c.id} c={c} wp={audit.wordpress} open={false} />)}</ul>
        </details>
      )}
    </section>
  );
}
