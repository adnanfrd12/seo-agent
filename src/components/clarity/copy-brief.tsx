"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies the plain-text issue brief (issues, fixes, recording links) to send to the web design team. */
export function CopyBrief({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked */ } }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-sunken">
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? "Copied" : "Copy for web design team"}
    </button>
  );
}
