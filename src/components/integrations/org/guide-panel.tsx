"use client";

import { GuideView } from "@/components/org/guides/guide-view";
import { guideFor, type GuideContext } from "@/lib/org/guides";

/**
 * One integration's setup guide (the same content as its PDF). Loaded on demand by the card's "Setup
 * instructions" toggle (next/dynamic), so the guides' text isn't part of every page load.
 */
export default function GuidePanel({ id, context, fallback }: { id: string; context: GuideContext; fallback?: React.ReactNode }) {
  const guide = guideFor(id, context);
  return guide ? <GuideView guide={guide} /> : <>{fallback ?? null}</>;
}
