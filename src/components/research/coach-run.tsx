"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { runCoach } from "@/app/(dashboard)/coach/actions";
import type { CoachMode } from "@/lib/ai/coach";

/** Generates (or regenerates) one analysis. Regenerating inside the 12-hour window asks first. */
export function CoachRun({ mode, canEdit, generatedAt, label }: { mode: CoachMode; canEdit: boolean; generatedAt: string | null; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return generatedAt ? null : <p className="text-xs text-muted">Only owners and admins can generate this analysis.</p>;
  return (
    <div className="space-y-1.5">
      <button disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        onClick={() => {
          const recent = generatedAt ? Date.now() - Date.parse(generatedAt) < 12 * 3_600_000 : false; // evaluated on click, not during render
          if (recent && !confirm("This was generated less than 12 hours ago. Generate a fresh one anyway? It costs about 15 cents.")) return;
          start(async () => { setMsg(null); const r = await runCoach(mode, recent); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); });
        }}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {generatedAt ? `Refresh ${label}` : `Generate ${label}`} <span className="opacity-70">(≈15¢)</span>
      </button>
      {pending && <p className="text-xs text-muted">Reading your data and writing the answer. This takes up to a minute.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
    </div>
  );
}
