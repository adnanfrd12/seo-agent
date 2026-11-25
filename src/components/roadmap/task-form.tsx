"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { addRoadmapTask, updateRoadmapTask } from "@/app/(dashboard)/roadmap/actions";
import { Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { CATEGORIES, EFFORTS, LEVELS, lastDayOf, monthLabel, type Category, type RoadmapTask } from "@/lib/roadmap/types";

const field = "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent";
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Add or edit a roadmap task. Lists (steps, pages, checklist) are one item per line; keywords are comma separated. */
export function TaskForm({ month, task, category, onClose, onDone }: { month: string; task: RoadmapTask | null; category?: Category; onClose: () => void; onDone: (message: string) => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    category: task?.category ?? category ?? "on_page", title: task?.title ?? "", description: task?.description ?? "", why: task?.why ?? "",
    steps: (task?.steps ?? []).join("\n"), urls: (task?.urls ?? []).join("\n"), keywords: (task?.keywords ?? []).join(", "),
    checklist: (task?.subtasks ?? []).map((s) => s.text).join("\n"), priority: task?.priority ?? "medium", impact: task?.impact ?? "medium",
    effort: task?.effort ?? "medium", due_date: task?.due_date ?? lastDayOf(month),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const base = {
      category: f.category as Category, title: f.title, description: f.description, why: f.why, steps: lines(f.steps), urls: lines(f.urls),
      keywords: f.keywords.split(",").map((x) => x.trim()).filter(Boolean), priority: f.priority as (typeof LEVELS)[number],
      impact: f.impact as (typeof LEVELS)[number], effort: f.effort as (typeof EFFORTS)[number], due_date: f.due_date || null,
    };
    start(async () => {
      let r;
      if (task) {
        // keep each checklist item's done state when its text is unchanged
        const texts = lines(f.checklist);
        const subtasks = texts.map((text) => { const old = task.subtasks.find((s) => s.text === text); return { id: old?.id, text, done: old?.done ?? false }; });
        r = await updateRoadmapTask(task.id, { ...base, subtasks });
      } else r = await addRoadmapTask(month, { ...base, subtasks: lines(f.checklist) });
      if (r.ok) onDone(r.message); else setErr(r.error);
    });
  };

  return (
    <Dialog open onClose={onClose} busy={pending} title={task ? "Edit task" : `Add a task to ${monthLabel(month)}`}>
      <form onSubmit={submit}>
        <DialogBody className="grid gap-3.5 text-foreground sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">Title
            <input required minLength={3} maxLength={300} value={f.title} onChange={set("title")} className={field} data-autofocus placeholder="e.g. Rewrite the title tag on the LED signs page" />
          </label>
          <label className="text-sm font-medium">Category
            <select value={f.category} onChange={set("category")} className={field}>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </label>
          <label className="text-sm font-medium">Due date
            <input type="date" value={f.due_date ?? ""} onChange={set("due_date")} className={field} />
          </label>
          <label className="text-sm font-medium">Priority
            <select value={f.priority} onChange={set("priority")} className={field}>{LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select>
          </label>
          <label className="text-sm font-medium">Expected impact
            <select value={f.impact} onChange={set("impact")} className={field}>{LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select>
          </label>
          <label className="text-sm font-medium sm:col-span-2">Description
            <textarea rows={3} maxLength={4000} value={f.description} onChange={set("description")} className={field} />
          </label>
          <label className="text-sm font-medium sm:col-span-2">Why it matters
            <textarea rows={2} maxLength={2000} value={f.why} onChange={set("why")} className={field} placeholder="The data behind it, e.g. 1,240 impressions at position 11" />
          </label>
          <label className="text-sm font-medium sm:col-span-2">Steps <span className="font-normal text-muted">(one per line)</span>
            <textarea rows={3} value={f.steps} onChange={set("steps")} className={field} />
          </label>
          <label className="text-sm font-medium">Pages <span className="font-normal text-muted">(one per line)</span>
            <textarea rows={2} value={f.urls} onChange={set("urls")} className={field} placeholder="https://…" />
          </label>
          <label className="text-sm font-medium">Keywords <span className="font-normal text-muted">(comma separated)</span>
            <textarea rows={2} value={f.keywords} onChange={set("keywords")} className={field} />
          </label>
          <label className="text-sm font-medium">Checklist <span className="font-normal text-muted">(one per line)</span>
            <textarea rows={3} value={f.checklist} onChange={set("checklist")} className={field} />
          </label>
          <label className="text-sm font-medium">Effort
            <select value={f.effort} onChange={set("effort")} className={field}>{EFFORTS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select>
          </label>
          {err && <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative sm:col-span-2">{err}</p>}
        </DialogBody>
        <DialogFooter>
          <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className={dialogBtn.primary} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" aria-hidden />} {task ? "Save changes" : "Add task"}</button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
