import Link from "next/link";
import { cn } from "@/lib/utils";
import { Delta, Spark } from "./charts";
import { Info } from "./info";
import { Table, type Col } from "./table";
type TaskItem = { rank: number; title: string; page: string; where: string; gain: number; effort: string };

/* Layout pieces of the GA4 leads screens: the sample dashboard's structure in the dashboard's own styles. */

const SPAN: Record<number, string> = {
  3: "lg:col-span-3", 4: "lg:col-span-4", 5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8", 12: "lg:col-span-12",
};

/** 12-column grid; each card says how many columns it takes on wide screens (full width on phones). */
export function Grid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12", className)}>{children}</div>;
}

/** A card: plain-language title, the technical name and how it's measured underneath, the ⓘ explanation. */
export function Card({ title, tech, sub, span = 12, info, children, className, head }: {
  title: string; tech?: string; sub?: React.ReactNode; span?: number; info?: string; children: React.ReactNode; className?: string; head?: React.ReactNode;
}) {
  const infoText = info ?? [tech, typeof sub === "string" ? sub : null].filter(Boolean).join(". ");
  return (
    <section className={cn("min-w-0 rounded-[10px] border border-border bg-surface p-4 md:col-span-2", SPAN[span] ?? SPAN[12], className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center text-[15px] font-semibold">{title}{infoText && <Info title={title} text={infoText} />}</h2>
          {(tech || sub) && <p className="mt-0.5 text-xs text-muted">{tech && <span className="font-mono text-[11px]">{tech}</span>}{tech && sub ? " · " : ""}{sub}</p>}
        </div>
        {head}
      </div>
      {children}
    </section>
  );
}

/** Section heading between groups of cards ("Charts", "Tables and lists", "Quick wins and tasks for this screen"). */
export function Band({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 first:mt-0">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">{title}</h2>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Kpis({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}
/** A tile: plain name, technical name, value, change vs the previous period, a note and a sparkline. */
export function Kpi({ label, tech, value, cur, prev, invert, note, spark, color, missing }: {
  label: string; tech?: string; value: string; cur?: number | null; prev?: number | null; invert?: boolean; note?: React.ReactNode; spark?: number[]; color?: string; missing?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface p-3.5">
      <div className="flex items-start text-[13px] font-medium leading-snug">
        <span className="min-w-0">{label}{tech && tech !== label && <small className="block font-mono text-[10.5px] font-normal text-faint">{tech}</small>}</span>
        {missing && <Info title={label} text={missing} />}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", missing && "text-faint")}>{value}</div>
      {cur !== undefined && prev !== undefined && <Delta cur={cur ?? null} prev={prev ?? null} invert={invert} className="mt-0.5" />}
      {note && <div className="mt-1 text-xs leading-snug text-muted">{note}</div>}
      {spark && spark.length > 1 && <Spark values={spark} color={color} />}
    </div>
  );
}

/** "000" with the reason and the one step that brings the data in. */
export function Missing({ title, why, fix }: { title?: string; why: string; fix: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-sunken p-4">
      <p className="text-2xl font-semibold tabular-nums text-faint">000</p>
      {title && <p className="mt-1 text-sm font-medium">{title}</p>}
      <p className="mt-1 text-[13px] text-secondary"><b className="font-medium text-foreground">Why: </b>{why}</p>
      <p className="mt-1 text-[13px] text-secondary"><b className="font-medium text-foreground">To bring it in: </b>{fix}</p>
    </div>
  );
}

export function Insight({ tone, title, text, when }: { tone: "good" | "bad" | "warn"; title: string; text: string; when: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-sunken p-3">
      <h3 className="flex items-start gap-2 text-sm font-semibold"><span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone === "good" ? "bg-positive" : tone === "bad" ? "bg-negative" : "bg-warn")} />{title}</h3>
      <p className="mt-1 text-[13px] text-secondary">{text}</p>
      <small className="mt-1.5 block text-xs text-muted">{when}</small>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-muted">{children}</p>;
}

/** The ranked task list at the bottom of each screen. */
export function ScreenTasks({ screen, wins, unit = "leads/mo", href = "/analytics/quick-wins" }: { screen: string; wins: TaskItem[]; unit?: string; href?: string }) {
  const cols: Col[] = [{ k: "rank", label: "#", num: true }, { k: "title", label: "Change", wrap: true }, { k: "page", label: "Page", kind: "page" }, { k: "where", label: "Where on the page", wrap: true }, { k: "gain", label: "Est. gain", num: true, f: "dec1" }, { k: "effort", label: "Effort" }];
  return (
    <>
      <Band title="Quick wins and tasks for this screen" sub="What to change based on the data above." />
      <Card title={`Quick wins and tasks: ${screen}`} sub="Changes to make based on this screen's data, ranked by gain ÷ effort.">
        {wins.length ? <Table cols={cols} rows={wins.slice(0, 10).map((w) => ({ rank: w.rank, title: w.title, page: w.page, where: w.where, gain: w.gain, effort: w.effort }))} limit={10} />
          : <p className="py-4 text-sm text-muted">Nothing to change here right now: none of the rules for this screen found a page or setting that holds leads back.</p>}
        <p className="mt-3 text-xs text-muted">Est. gain is in {unit}. <Link href={href} className="underline underline-offset-2 hover:text-foreground">See every quick win with its evidence and steps</Link>.</p>
      </Card>
    </>
  );
}
