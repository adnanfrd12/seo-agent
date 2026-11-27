import { Fragment } from "react";
import { ExternalLink } from "lucide-react";
import { inlineTokens, type Guide, type GuidePart } from "@/lib/org/guides";
import { cn } from "@/lib/utils";

/**
 * A setup guide on screen (the "Setup instructions" panel of an integration card): the same content as the PDF,
 * compact. No state or effects, so it renders on the server or the client. Usage:
 *   <GuideView guide={guideFor(id, { appUrl, appName, orgName })!} />
 */
const link = "break-all font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground";

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((t, i) => (
        <Fragment key={i}>
          {t.kind === "strong" ? <span className="font-medium text-foreground">{t.text}</span>
            : t.kind === "code" ? <code className="break-all rounded bg-surface-muted px-1 py-px font-mono text-[12px] text-foreground">{t.text}</code>
            : t.kind === "link" ? <a href={t.text} target="_blank" rel="noopener noreferrer" className={link}>{t.text}</a>
            : t.text}
        </Fragment>
      ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[13px] font-semibold text-foreground"><Inline text={title} /></h4>
      {children}
    </section>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-1 pl-5 marker:text-faint">{items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>
);

function Steps({ part, letter }: { part: GuidePart; letter?: string }) {
  return (
    <div className="space-y-1.5">
      {part.title && (
        <h4 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          {letter && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-surface" aria-hidden>{letter}</span>}
          <span><Inline text={part.title} /></span>
        </h4>
      )}
      {part.intro && <p><Inline text={part.intro} /></p>}
      {part.steps.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 marker:text-muted">
          {part.steps.map((s, i) => (
            <li key={i}>
              <Inline text={s.text} />
              {s.sub && <ul className="mt-1 list-disc space-y-0.5 pl-5 marker:text-faint">{s.sub.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
      {part.note && <p className="rounded-md border-l-2 border-accent bg-accent-soft px-2.5 py-1.5 text-foreground"><Inline text={part.note} /></p>}
    </div>
  );
}

function Folded({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-surface px-3 py-2">
      <summary className="cursor-pointer text-[13px] font-semibold text-foreground marker:text-muted">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function GuideView({ guide, className }: { guide: Guide; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-4 text-[13px] leading-relaxed text-secondary", className)}>
      <div className="space-y-1.5">
        <p><Inline text={guide.purpose} /></p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted">Cost</dt><dd className="min-w-0"><Inline text={guide.cost} /></dd>
          <dt className="text-muted">Time</dt><dd className="min-w-0"><Inline text={guide.time} /></dd>
        </dl>
      </div>

      {guide.requirements.length > 0 && <Section title="Before you start"><Bullets items={guide.requirements} /></Section>}
      {guide.parts.map((p, i) => <Steps key={i} part={p} letter={String.fromCharCode(65 + i)} />)}
      {guide.apis.length > 0 && <Section title="APIs to enable"><Bullets items={guide.apis} /></Section>}
      {guide.scopes.length > 0 && (
        <Section title="Permissions (OAuth scopes)">
          <ul className="space-y-1">
            {guide.scopes.map((s) => <li key={s.scope}><code className="break-all text-[12px] text-foreground">{s.scope}</code>: <Inline text={s.why} /></li>)}
          </ul>
        </Section>
      )}
      {guide.addresses.length > 0 && (
        <Section title="Addresses to copy">
          <ul className="space-y-1.5">
            {guide.addresses.map((a) => (
              <li key={a.value} className="rounded-lg border border-border bg-surface px-3 py-2">
                <span className="block font-medium text-foreground">{a.label}</span>
                <code className="block select-all break-all font-mono text-[12px] text-foreground">{a.value}</code>
                {a.note && <span className="block text-xs text-muted"><Inline text={a.note} /></span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={guide.enter.title}>
        <Steps part={{ ...guide.enter, title: "" }} />
        {guide.fields.length > 0 && (
          <dl className="divide-y divide-hairline rounded-lg border border-border bg-surface">
            {guide.fields.map((f) => (
              <div key={f.key} className="px-3 py-2">
                <dt className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-foreground">{f.label}</span>
                  <code className="break-all font-mono text-[11px] text-muted">{f.key}</code>
                  <span className="text-xs text-muted">{f.required ? "Required" : "Optional"}{f.secret ? " · secret" : ""}</span>
                </dt>
                <dd className="mt-0.5"><Inline text={f.source} /></dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Test the connection"><Bullets items={guide.test} /></Section>
      {guide.problems.length > 0 && (
        <Folded title="Troubleshooting">
          <dl className="space-y-2">
            {guide.problems.map((p, i) => (
              <div key={i}>
                <dt className="font-medium text-foreground"><Inline text={p.problem} /></dt>
                <dd><Inline text={p.fix} /></dd>
              </div>
            ))}
          </dl>
        </Folded>
      )}
      {guide.renewal.length > 0 && <Folded title="Expiry and renewal"><Bullets items={guide.renewal} /></Folded>}
      {guide.checklist.length > 0 && (
        <Section title="Checklist">
          <ul className="space-y-1">
            {guide.checklist.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-[3px] size-3.5 shrink-0 rounded-[3px] border border-border-strong" aria-hidden />
                <span><Inline text={c} /></span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {guide.links.length > 0 && (
        <Section title="Official links">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {guide.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
                  {l.label} <ExternalLink className="size-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {guide.unverified.length > 0 && (
        <p className="text-xs text-muted">
          Not confirmed in the provider&apos;s documentation: {guide.unverified.map((u, i) => <Fragment key={i}>{i > 0 && " "}<Inline text={u} /></Fragment>)}
        </p>
      )}
    </div>
  );
}
