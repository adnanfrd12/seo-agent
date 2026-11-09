"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

/** Downloads generated text (disavow.txt, llms.txt) without a server round trip. */
export function DownloadText({ text, filename, label }: { text: string; filename: string; label: string }) {
  return (
    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60" disabled={!text}
      onClick={() => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }}>
      <Download className="size-4" /> {label}
    </button>
  );
}

export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      {done ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />} {done ? "Copied" : label}
    </button>
  );
}
