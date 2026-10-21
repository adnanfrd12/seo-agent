"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/**
 * On-screen toolbar for the report view (hidden when printing). With ?print=1 it opens the print
 * dialog once charts have had time to lay out, so "Save as PDF" captures a finished page.
 */
export function PrintControls({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 1200);
    return () => clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="no-print sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span className="text-muted">Report preview. Use Print → &quot;Save as PDF&quot; to download.</span>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-foreground hover:opacity-90">
          <Printer className="size-4" aria-hidden /> Print / Save PDF
        </button>
      </div>
    </div>
  );
}
