"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bot, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FileText, KeyRound, Layers, Link2, ListChecks, Loader2,
  MapPin, MousePointerClick, Pencil, PenLine, Plus, RefreshCw, Search, Share2, Sparkles, Target, Trash2, Wrench, type LucideIcon,
} from "lucide-react";
import { deleteRoadmapTask, generateRoadmap, setRoadmapTaskStatus, toggleRoadmapSubtask } from "@/app/(dashboard)/roadmap/actions";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, dialogBtn, disconnectIcon } from "@/components/dashboard/dialog";
import { TaskForm } from "@/components/roadmap/task-form";
import { addMonths, CATEGORIES, isOpen, monthLabel, ROADMAP_CHANGED, STATUS_LABEL, STATUSES, type Category, type RoadmapMonth, type RoadmapTask, type TaskStatus } from "@/lib/roadmap/types";
import { cn } from "@/lib/utils";

const ICON: Record<Category, LucideIcon> = {
  on_page: FileText, technical: Wrench, off_page: Link2, content: PenLine, local: MapPin, social: Share2,
  keywords: KeyRound, cro: MousePointerClick, ai_visibility: Bot, other: Layers,
};
const LEVEL_TONE = { high: "bg-negative-soft text-negative", medium: "bg-warn-soft text-warn", low: "bg-surface-muted text-muted" } as const;
const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60";
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Opens Nova with a prompt (the Nova panel listens for this event). */
export const askNova = (prompt: string) => window.dispatchEvent(new CustomEvent("nova:open", { detail: { prompt } }));

export function RoadmapView({ month, current, today, months, row, tasks, canEdit, aiConfigured }: {
  month: string; current: string; today: string; months: string[]; row: RoadmapMonth | null; tasks: RoadmapTask[]; canEdit: boolean; aiConfigured: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<{ task: RoadmapTask | null; category?: Category } | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  // changes made by Nova (or another tab) refresh this view without a reload
  useEffect(() => {
    const on = () => router.refresh();
    window.addEventListener(ROADMAP_CHANGED, on);
    return () => window.removeEventListener(ROADMAP_CHANGED, on);
  }, [router]);

  const counted = tasks.filter((t) => t.status !== "skipped");
  const doneN = counted.filter((t) => t.status === "done").length;
  const pct = counted.length ? Math.round((doneN / counted.length) * 100) : 0;
  const overdue = tasks.filter((t) => isOpen(t) && t.due_date && t.due_date < today);
  const isCurrent = month === current, isPast = month < current;
  const q = query.trim().toLowerCase();
  const visible = tasks.filter((t) => (filter === "all" || (filter === "open" ? isOpen(t) : t.status === "done"))
    && (!q || `${t.title} ${t.description} ${t.keywords.join(" ")} ${t.urls.join(" ")}`.toLowerCase().includes(q)));
  const go = (m: string) => router.push(`/roadmap?m=${m.slice(0, 7)}`);
  const allMonths = [...new Set([...months, current, addMonths(current, 1), month])].sort().reverse();

  return (
    <div className="space-y-5">
      {/* month switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => go(addMonths(month, -1))} aria-label="Previous month" className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"><ChevronLeft className="size-4" /></button>
          <label className="relative">
            <span className="sr-only">Month</span>
            <select value={month} onChange={(e) => go(e.target.value)} className="h-9 appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === current ? " (current)" : months.includes(m) ? "" : " (empty)"}</option>)}
            </select>
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          </label>
          <button type="button" onClick={() => go(addMonths(month, 1))} aria-label="Next month" className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"><ChevronRight className="size-4" /></button>
          {isCurrent ? <span className="ml-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">Current month</span>
            : <button type="button" onClick={() => go(current)} className="ml-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-secondary hover:bg-surface-muted">Back to {monthLabel(current, true)}</button>}
          {isPast && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-muted">History</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={cn(btn, "border border-border bg-surface hover:bg-surface-muted")} onClick={() => askNova(row ? `Review my ${monthLabel(month)} roadmap and tell me what to focus on next.` : `Help me plan ${monthLabel(month)}.`)}>
            <Sparkles className="size-4 text-accent" aria-hidden /> Ask Nova
          </button>
          {canEdit && <button type="button" className={cn(btn, "border border-border bg-surface hover:bg-surface-muted")} onClick={() => setForm({ task: null })}><Plus className="size-4" aria-hidden /> Add task</button>}
          {canEdit && aiConfigured && (
            <button type="button" className={cn(btn, "bg-accent text-accent-foreground hover:opacity-90")} onClick={() => setGenOpen(true)}>
              {row?.generated_at ? <RefreshCw className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />} {row?.generated_at ? "Refresh strategy" : "Generate strategy"}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative")}>
          {msg.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}<span>{msg.text}</span>
        </p>
      )}

      {!row?.generated_at && tasks.length === 0 ? (
        <EmptyMonth month={month} canEdit={canEdit} aiConfigured={aiConfigured} onGenerate={() => setGenOpen(true)} onAdd={() => setForm({ task: null })} />
      ) : (
        <>
          {/* overview */}
          <section aria-label="Month overview" className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="rounded-[12px] border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-semibold">{monthLabel(month)} strategy</h2>
                {row?.generated_at && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted">{row.generated_by === "schedule" ? "Prepared automatically" : row.generated_by === "nova" ? "By Nova" : row.generated_by === "manual" ? "Manual" : "AI generated"} · {new Date(row.generated_at).toLocaleDateString()}</span>}
                {row?.focus && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">Focus: {row.focus}</span>}
              </div>
              {row?.summary && <p className="mt-2 max-w-[95ch] text-sm leading-relaxed text-secondary">{row.summary}</p>}
              {(row?.objectives.length ?? 0) > 0 && (
                <ol className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {row!.objectives.map((o, i) => (
                    <li key={i} className="flex gap-3 rounded-lg border border-hairline bg-surface-sunken p-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-surface">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold leading-snug">{o.title}</p>
                        {o.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted">{o.detail}</p>}
                        {o.metric && <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-secondary ring-1 ring-border"><Target className="size-3" aria-hidden />{o.metric}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {row?.sources?.length ? <p className="mt-3 text-[11px] text-faint">Built from: {row.sources.join(" · ")}</p> : null}
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-[12px] border border-border bg-surface p-5">
                <div className="flex items-center gap-4">
                  <Ring pct={pct} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{doneN} of {counted.length} tasks done</p>
                    <p className="mt-0.5 text-xs text-muted">{counted.length - doneN} open{overdue.length ? <> · <span className="font-medium text-negative">{overdue.length} overdue</span></> : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      {STATUSES.map((s) => { const n = tasks.filter((t) => t.status === s).length; return n ? <span key={s} className="rounded-full bg-surface-muted px-2 py-0.5 text-secondary">{STATUS_LABEL[s]} {n}</span> : null; })}
                    </div>
                  </div>
                </div>
              </div>
              {((row?.priorities.length ?? 0) > 0 || (row?.expected_outcomes.length ?? 0) > 0) && (
                <div className="flex-1 rounded-[12px] border border-border bg-surface p-5 text-sm">
                  {(row?.priorities.length ?? 0) > 0 && (<>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Priorities</h3>
                    <ol className="mt-2 space-y-1.5">{row!.priorities.map((x, i) => <li key={i} className="flex gap-2"><span className="font-semibold tabular-nums text-accent">{i + 1}.</span><span className="leading-snug">{x}</span></li>)}</ol>
                  </>)}
                  {(row?.expected_outcomes.length ?? 0) > 0 && (<>
                    <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Expected outcomes</h3>
                    <ul className="mt-2 space-y-1.5 text-secondary">{row!.expected_outcomes.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-positive" aria-hidden /><span className="leading-snug">{x}</span></li>)}</ul>
                    <p className="mt-2 text-[11px] text-faint">Hypotheses to check next month, not guarantees.</p>
                  </>)}
                </div>
              )}
            </div>
          </section>

          {/* toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Show" className="inline-flex gap-0.5 rounded-lg bg-surface-muted p-[3px] text-sm">
              {([["all", `All ${tasks.length}`], ["open", `Open ${tasks.filter(isOpen).length}`], ["done", `Done ${tasks.filter((t) => t.status === "done").length}`]] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={cn("rounded-md px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent", filter === k ? "bg-surface font-medium shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-secondary hover:text-foreground")}>{l}</button>
              ))}
            </div>
            <label className="relative w-full sm:w-64">
              <span className="sr-only">Search tasks</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks, pages, keywords" className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            </label>
          </div>

          {/* categories */}
          <div className="space-y-3">
            {CATEGORIES.map((c) => {
              const all = tasks.filter((t) => t.category === c.key);
              const shown = visible.filter((t) => t.category === c.key);
              if (!all.length || !shown.length) return null;
              return <CategorySection key={c.key} category={c.key} label={c.label} all={all} shown={shown} today={today} canEdit={canEdit}
                defaultOpen={(isCurrent || month > current) && all.some(isOpen) || Boolean(q) || filter !== "all"}
                onEdit={(t) => setForm({ task: t })} onAdd={() => setForm({ task: null, category: c.key })} onMsg={setMsg} />;
            })}
            {visible.length === 0 && <p className="rounded-[12px] border border-dashed border-border px-6 py-10 text-center text-sm text-muted">No tasks match.</p>}
          </div>
        </>
      )}

      {form && <TaskForm month={month} task={form.task} category={form.category} onClose={() => setForm(null)} onDone={(text) => { setForm(null); setMsg({ ok: true, text }); router.refresh(); }} />}
      <GenerateDialog open={genOpen} month={month} refresh={Boolean(row?.generated_at || tasks.length)} taskCount={tasks.length} focus={row?.focus ?? ""}
        onClose={() => setGenOpen(false)} onDone={(r) => { setGenOpen(false); setMsg(r); router.refresh(); }} />
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-16 shrink-0 place-items-center" role="img" aria-label={`${pct}% complete`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-muted)" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--positive)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <span className="text-sm font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

function EmptyMonth({ month, canEdit, aiConfigured, onGenerate, onAdd }: { month: string; canEdit: boolean; aiConfigured: boolean; onGenerate: () => void; onAdd: () => void }) {
  return (
    <section className="rounded-[12px] border border-dashed border-border bg-surface px-6 py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent"><ListChecks className="size-6" aria-hidden /></span>
      <h2 className="mt-4 text-lg font-semibold">No roadmap for {monthLabel(month)} yet</h2>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-muted">Generate a personalised strategy from this client&apos;s connected data, ask Nova to plan it with you, or add tasks yourself.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {canEdit && aiConfigured && <button type="button" className={cn(btn, "bg-accent text-accent-foreground hover:opacity-90")} onClick={onGenerate}><Sparkles className="size-4" aria-hidden /> Generate strategy</button>}
        <button type="button" className={cn(btn, "border border-border bg-surface hover:bg-surface-muted")} onClick={() => askNova(`Plan my SEO roadmap for ${monthLabel(month)}.`)}><Sparkles className="size-4 text-accent" aria-hidden /> Plan with Nova</button>
        {canEdit && <button type="button" className={cn(btn, "border border-border bg-surface hover:bg-surface-muted")} onClick={onAdd}><Plus className="size-4" aria-hidden /> Add a task</button>}
      </div>
      {!canEdit && <p className="mt-4 text-xs text-muted">Owners and admins can generate and edit the roadmap.</p>}
    </section>
  );
}

function CategorySection({ category, label, all, shown, today, canEdit, defaultOpen, onEdit, onAdd, onMsg }: {
  category: Category; label: string; all: RoadmapTask[]; shown: RoadmapTask[]; today: string; canEdit: boolean; defaultOpen: boolean;
  onEdit: (t: RoadmapTask) => void; onAdd: () => void; onMsg: (m: { ok: boolean; text: string }) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = ICON[category];
  const counted = all.filter((t) => t.status !== "skipped");
  const done = counted.filter((t) => t.status === "done").length;
  const highOpen = all.filter((t) => isOpen(t) && t.priority === "high").length;
  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-secondary"><Icon className="size-[18px]" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{label}</span>
          <span className="block text-xs text-muted">{done} of {counted.length} done{highOpen ? ` · ${highOpen} high priority open` : ""}</span>
        </span>
        <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted sm:block" aria-hidden><span className="block h-full rounded-full bg-positive" style={{ width: `${counted.length ? (done / counted.length) * 100 : 0}%` }} /></span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-hairline">
          <ul className="divide-y divide-hairline">{shown.map((t) => <TaskRow key={t.id} t={t} today={today} canEdit={canEdit} onEdit={() => onEdit(t)} onMsg={onMsg} />)}</ul>
          {canEdit && <button type="button" onClick={onAdd} className="flex w-full items-center gap-1.5 border-t border-hairline px-5 py-2.5 text-xs font-medium text-muted outline-none hover:bg-surface-sunken hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><Plus className="size-3.5" aria-hidden /> Add a task to {label}</button>}
        </div>
      )}
    </section>
  );
}

function TaskRow({ t, today, canEdit, onEdit, onMsg }: { t: RoadmapTask; today: string; canEdit: boolean; onEdit: () => void; onMsg: (m: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<TaskStatus>(t.status);
  const [subs, setSubs] = useState(t.subtasks);
  const [del, setDel] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  // server data changed (this page, Nova or another tab): take it over, keeping the row open
  const [seen, setSeen] = useState(t.updated_at);
  if (seen !== t.updated_at) { setSeen(t.updated_at); setStatus(t.status); setSubs(t.subtasks); }
  const done = status === "done";
  const late = isOpen({ status }) && t.due_date && t.due_date < today;
  const subDone = subs.filter((s) => s.done).length;

  const setTo = (s: TaskStatus) => {
    const prev = status; setStatus(s);
    start(async () => { const r = await setRoadmapTaskStatus(t.id, s); if (!r.ok) { setStatus(prev); onMsg({ ok: false, text: r.error }); } else { router.refresh(); window.dispatchEvent(new Event(ROADMAP_CHANGED)); } });
  };
  const toggleSub = (id: string, v: boolean) => {
    const prev = subs; setSubs(subs.map((s) => (s.id === id ? { ...s, done: v } : s)));
    start(async () => { const r = await toggleRoadmapSubtask(t.id, id, v); if (!r.ok) { setSubs(prev); onMsg({ ok: false, text: r.error }); } });
  };

  return (
    <li className={cn("group", status === "skipped" && "opacity-60")}>
      <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <button type="button" role="checkbox" aria-checked={done} aria-label={done ? `Reopen "${t.title}"` : `Mark "${t.title}" done`} onClick={() => setTo(done ? "todo" : "done")} disabled={pending}
          className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border outline-none transition focus-visible:ring-2 focus-visible:ring-accent", done ? "border-positive bg-positive text-surface" : "border-border-strong bg-surface hover:border-positive")}>
          {done && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
          <span className={cn("block text-sm font-medium leading-snug", done && "text-muted line-through decoration-border-strong")}>{t.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={cn("rounded-full px-2 py-0.5 font-medium", LEVEL_TONE[t.priority])}>{t.priority[0].toUpperCase() + t.priority.slice(1)} priority</span>
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-secondary">{t.impact} impact</span>
            {t.due_date && <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", late ? "bg-negative-soft font-medium text-negative" : "bg-surface-muted text-secondary")}><CalendarDays className="size-3" aria-hidden />{late ? "Overdue · " : ""}{fmtDate(t.due_date)}</span>}
            {subs.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-secondary"><ListChecks className="size-3" aria-hidden />{subDone}/{subs.length}</span>}
            {status === "in_progress" && <span className="rounded-full bg-series-soft px-2 py-0.5 font-medium text-series">In progress</span>}
            <span className="text-faint">{t.source === "ai" ? "AI" : t.source === "nova" ? "Nova" : "Manual"}</span>
          </span>
        </button>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted transition-transform", !open && "-rotate-90")} aria-hidden />
      </div>

      {open && (
        <div className="space-y-4 px-4 pb-5 pl-12 text-sm sm:px-5 sm:pl-[3.25rem]">
          {t.description && <p className="leading-relaxed text-secondary">{t.description}</p>}
          {(t.why || t.evidence.length > 0) && (
            <div className="rounded-lg border border-hairline bg-surface-sunken p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Why this matters</p>
              {t.why && <p className="mt-1.5 leading-relaxed">{t.why}</p>}
              {t.evidence.length > 0 && (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {t.evidence.slice(0, 8).map((e) => (
                    <li key={e.ref} title={e.ref} className="max-w-full rounded-md bg-surface px-2 py-1 text-[11px] ring-1 ring-border"><span className="text-muted">{e.source} · {e.label}:</span> <span className="font-medium">{e.value}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {t.steps.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">How to do it</p>
              <ol className="mt-2 space-y-1.5">{t.steps.map((s, i) => <li key={i} className="flex gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-muted text-[11px] font-semibold tabular-nums text-secondary">{i + 1}</span><span className="leading-relaxed">{s}</span></li>)}</ol>
            </div>
          )}
          {(t.urls.length > 0 || t.keywords.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {t.urls.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Pages</p><ul className="mt-1.5 space-y-1">{t.urls.map((u) => <li key={u} className="truncate">{/^https?:\/\//.test(u) ? <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-secondary underline decoration-border-strong underline-offset-2 hover:text-foreground">{u.replace(/^https?:\/\/(www\.)?/, "")}<ExternalLink className="size-3 shrink-0" aria-hidden /></a> : <span className="text-secondary">{u}</span>}</li>)}</ul></div>}
              {t.keywords.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Keywords</p><ul className="mt-1.5 flex flex-wrap gap-1.5">{t.keywords.map((k) => <li key={k} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">{k}</li>)}</ul></div>}
            </div>
          )}
          {subs.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Checklist · {subDone}/{subs.length}</p>
              <ul className="mt-2 space-y-1">
                {subs.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-sunken">
                      <input type="checkbox" checked={s.done} onChange={(e) => toggleSub(s.id, e.target.checked)} className="mt-0.5 size-4 accent-[var(--positive)]" />
                      <span className={cn("leading-snug", s.done && "text-muted line-through")}>{s.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            <label className="inline-flex items-center gap-2 text-xs text-muted">Status
              <select value={status} onChange={(e) => setTo(e.target.value as TaskStatus)} disabled={pending} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            {pending && <Loader2 className="size-4 animate-spin text-muted" aria-label="Saving" />}
            <span className="flex-1" />
            <button type="button" onClick={() => askNova(`Explain the roadmap task "${t.title}" (id ${t.id}) and how to do it best for this site.`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-secondary hover:bg-surface-muted hover:text-foreground"><Sparkles className="size-3.5 text-accent" aria-hidden /> Ask Nova</button>
            {canEdit && <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-secondary hover:bg-surface-muted hover:text-foreground"><Pencil className="size-3.5" aria-hidden /> Edit</button>}
            {canEdit && <button type="button" onClick={() => { setDelErr(null); setDel(true); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-negative hover:bg-negative-soft"><Trash2 className="size-3.5" aria-hidden /> Delete</button>}
          </div>
        </div>
      )}
      <ConfirmDialog open={del} onClose={() => setDel(false)} title="Delete this task?" confirmLabel="Delete" busy={pending} error={delErr} icon={disconnectIcon}
        onConfirm={() => start(async () => { const r = await deleteRoadmapTask(t.id); if (r.ok) { setDel(false); onMsg({ ok: true, text: r.message }); router.refresh(); } else setDelErr(r.error); })}>
        <p><strong className="font-medium text-foreground">{t.title}</strong> is removed from the roadmap. The change is kept in the roadmap history. This can&apos;t be undone.</p>
      </ConfirmDialog>
    </li>
  );
}

function GenerateDialog({ open, month, refresh, taskCount, focus, onClose, onDone }: { open: boolean; month: string; refresh: boolean; taskCount: number; focus: string; onClose: () => void; onDone: (m: { ok: boolean; text: string }) => void }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(focus);
  const [err, setErr] = useState<string | null>(null);
  const label = useMemo(() => monthLabel(month), [month]);
  return (
    <Dialog open={open} onClose={onClose} busy={pending} size="md"
      icon={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Sparkles className="size-5" aria-hidden /></span>}
      title={refresh ? `Refresh the ${label} strategy` : `Generate the ${label} strategy`}
      description={refresh ? <>Claude re-reads the latest data and rewrites the open AI tasks nobody has started. Completed, started, manually added and Nova tasks are kept ({taskCount} tasks now).</> : <>Claude reads this client&apos;s connected data and writes the month&apos;s objectives, priorities and tasks by category. It takes a minute or two.</>}>
      <DialogBody>
        <label className="block text-sm font-medium text-foreground" htmlFor="focus">Focus (optional)</label>
        <input id="focus" value={value} onChange={(e) => setValue(e.target.value)} maxLength={400} placeholder="e.g. more backlinks and local SEO" disabled={pending}
          className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        {pending && <p className="mt-3 flex items-center gap-2 text-sm text-secondary"><Loader2 className="size-4 animate-spin" aria-hidden /> Reading the data and writing the strategy…</p>}
        {err && <p role="alert" className="mt-3 rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative">{err}</p>}
      </DialogBody>
      <DialogFooter>
        <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={pending}>Cancel</button>
        <button type="button" data-autofocus className={dialogBtn.primary} disabled={pending}
          onClick={() => { setErr(null); start(async () => { const r = await generateRoadmap(month, value); if (r.ok) onDone({ ok: true, text: r.message }); else setErr(r.error); }); }}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />} {refresh ? "Refresh" : "Generate"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
