import { z } from "zod";
import { clip } from "./lists";

/**
 * Clarity recording reviews: observations people log after watching recordings in Clarity (table
 * clarity_recording_reviews; the AI analysis uses them as evidence). The values match the table's checks and the
 * dashboard's form (src/app/(dashboard)/clarity/actions.ts).
 */
export const FRICTION = ["rage_clicks", "dead_clicks", "non_interactive_click", "form_friction", "confusing_navigation",
  "missed_cta", "excessive_scroll", "abandonment", "mobile_usability", "broken_cta", "error", "other"] as const;
export const FRICTION_LABEL: Record<(typeof FRICTION)[number], string> = {
  rage_clicks: "Rage clicks", dead_clicks: "Dead clicks", non_interactive_click: "Clicking non-interactive element", form_friction: "Form friction",
  confusing_navigation: "Confusing navigation", missed_cta: "Important button overlooked", excessive_scroll: "Excessive scrolling without engagement",
  abandonment: "Abandoned at this point", mobile_usability: "Mobile usability problem", broken_cta: "Broken or misleading CTA", error: "Error shown", other: "Other",
};
export const DEVICES = ["desktop", "mobile", "tablet", "unknown"] as const;
export const SEVERITIES = ["low", "medium", "high"] as const;

export const reviewFields = {
  page_url: z.string().trim().min(1).max(2000),
  recording_url: z.string().trim().max(2000).describe("https link to the recording in Clarity"),
  device: z.enum(DEVICES),
  observed_on: z.string().trim().describe("YYYY-MM-DD"),
  friction_type: z.enum(FRICTION),
  severity: z.enum(SEVERITIES),
  observation: z.string().trim().min(3).max(4000),
};

export interface ReviewRow {
  id: string; page_url: string; recording_url: string | null; device: string | null; observed_on: string | null;
  friction_type: string; severity: string; observation: string; reviewer: string | null; created_at: string;
}
export const REVIEW_COLS = "id, page_url, recording_url, device, observed_on, friction_type, severity, observation, reviewer, created_at";

const labelOf = (f: string) => FRICTION_LABEL[f as keyof typeof FRICTION_LABEL] ?? f;
/** `high · Rage clicks · /contact (mobile, 2026-11-20): "Visitor clicked…"` */
export const describeReview = (r: Pick<ReviewRow, "severity" | "friction_type" | "page_url" | "device" | "observed_on" | "observation">) => {
  const when = [r.device === "unknown" ? null : r.device, r.observed_on].filter(Boolean);
  return `${r.severity} · ${labelOf(r.friction_type)} · ${clip(r.page_url, 90)}${when.length ? ` (${when.join(", ")})` : ""}: "${clip(r.observation, 110)}"`;
};

/** null when fine, else what's wrong with an optional recording link or date. */
export function checkReviewExtras(recording: string | undefined, date: string | undefined): string | null {
  if (recording && !/^https:\/\//i.test(recording)) return "The recording link must be an https URL.";
  if (date && !z.iso.date().safeParse(date).success) return `"${date}" isn't a date (use YYYY-MM-DD).`;
  return null;
}
