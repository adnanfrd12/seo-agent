"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { generateAnalysis } from "@/app/(dashboard)/ai-actions";

/**
 * Makes analyses "just there":
 *  - running: something (the monthly schedule or another admin) is generating; poll until it lands
 *  - autoStart: nothing has ever been generated; start the first run once (guarded per tab/period)
 */
export function AutoAnalysis({ kind, start, end, autoStart, running }: {
  kind: "insights" | "strategy"; start: string; end: string; autoStart: boolean; running: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "error">(running ? "working" : "idle");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [running, router]);

  useEffect(() => {
    if (!autoStart || running || started.current) return;
    const key = `auto-ai:${kind}:${start}:${end}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage blocked: rely on the server guard */ }
    started.current = true;
    // deferred so the state update happens after the effect, not synchronously inside it
    const t = setTimeout(() => {
      setState("working");
      generateAnalysis(kind, start, end).then((r) => {
        if (!r.ok) { setState("error"); setError(r.error); }
        router.refresh();
      });
    }, 0);
    return () => clearTimeout(t);
  }, [autoStart, running, kind, start, end, router]);

  if (state === "idle") return null;
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-[10px] border border-accent/30 bg-accent-soft p-4 text-sm">
      {state === "working" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" /> : <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />}
      <div>
        {state === "working" ? (
          <>
            <p className="font-medium">Preparing your {kind === "insights" ? "AI analysis" : "30-day strategy"} for {start} → {end}…</p>
            <p className="text-muted">This usually takes a minute or two. The page updates by itself when it&apos;s ready.</p>
          </>
        ) : (
          <p className="text-negative">{error}</p>
        )}
      </div>
    </div>
  );
}
