/** SEO Roadmap: shared types and labels (server and client code). */

export const CATEGORIES = [
  { key: "on_page", label: "On-Page SEO" },
  { key: "technical", label: "Technical SEO" },
  { key: "off_page", label: "Off-Page SEO & Backlinks" },
  { key: "content", label: "Content Strategy" },
  { key: "local", label: "Local SEO & Business Profile" },
  { key: "social", label: "Social Media" },
  { key: "keywords", label: "Keyword Research & Optimization" },
  { key: "cro", label: "Conversion Rate Optimization" },
  { key: "ai_visibility", label: "AI Search Visibility" },
  { key: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [Category, ...Category[]];
export const categoryLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

export const STATUSES = ["todo", "in_progress", "done", "skipped"] as const;
export type TaskStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done", skipped: "Skipped" };
export const LEVELS = ["high", "medium", "low"] as const;
export type Level = (typeof LEVELS)[number];
export const EFFORTS = ["small", "medium", "large"] as const;

export interface Subtask { id: string; text: string; done: boolean }
export interface EvidenceRef { ref: string; source: string; label: string; value: string }

export interface RoadmapTask {
  id: string; client_id: string; month_id: string; category: Category; title: string; description: string; why: string;
  evidence: EvidenceRef[]; steps: string[]; urls: string[]; keywords: string[]; subtasks: Subtask[];
  priority: Level; impact: Level; effort: (typeof EFFORTS)[number]; status: TaskStatus; due_date: string | null;
  source: "ai" | "manual" | "nova"; sort: number; completed_at: string | null; created_at: string; updated_at: string;
}

export interface RoadmapMonth {
  id: string; client_id: string; month: string; summary: string;
  objectives: { title: string; detail: string; metric?: string | null }[];
  priorities: string[]; expected_outcomes: string[]; focus: string | null; sources: string[];
  generated_by: "ai" | "schedule" | "nova" | "manual"; model: string | null; generated_at: string | null; updated_at: string;
}

/** First day of the month of an ISO date ("2026-11-24" → "2026-11-01"). */
export const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
export const addMonths = (month: string, n: number) => {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
export const monthLabel = (month: string, short = false) =>
  new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" });
export const lastDayOf = (month: string) => { const d = new Date(`${addMonths(month, 1)}T00:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

/** Same category and nearly the same title = the same task (stops duplicates from AI refreshes and Nova). */
export const dedupeKey = (category: string, title: string) =>
  `${category}:${title.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an|to|for|of|on|in|and|your|our)\b/g, " ").replace(/\s+/g, " ").trim()}`;

export const isOpen = (t: Pick<RoadmapTask, "status">) => t.status === "todo" || t.status === "in_progress";

/** Browser event fired after any roadmap change (Nova or the page), so open views refresh without a reload. */
export const ROADMAP_CHANGED = "roadmap:changed";
