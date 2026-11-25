"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { startQuickWins } from "@/app/(dashboard)/ai-quick-wins/actions";
import { SOURCES } from "@/lib/aiqw/types";
import { RunSteps, useRun } from "./generate-panel";

/** "✨ Quick wins for this screen": runs only this screen's rules (fast, cheap); the list below refreshes when done. */
export function ScreenRunButton({ screen, canEdit }: { screen: string; canEdit: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const onEnd = useCallback(() => router.refresh(), [router]);
  const { run, setRunId } = useRun(null, onEnd);
  const running = run?.status === "running";
  return (
    <div className="space-y-2">
      <button type="button" disabled={!canEdit || running} onClick={async () => { setErr(null); const r = await startQuickWins({ scope: { kind: "screen", screen }, depth: "standard", sources: SOURCES }); if (r.ok) setRunId(r.runId); else setErr(r.error); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50">
        {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />} Quick wins for this screen
      </button>
      {!canEdit && <p className="text-xs text-muted">Owners and admins can run it.</p>}
      {err && <p role="alert" className="text-xs text-negative">{err}</p>}
      {run && run.status !== "done" && <RunSteps run={run} />}
    </div>
  );
}
