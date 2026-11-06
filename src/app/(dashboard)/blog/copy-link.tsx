"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies the post's address for sharing anywhere. */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium hover:bg-surface-muted">
      {done ? <Check className="size-3.5 text-positive" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {done ? "Copied" : "Copy link"}
    </button>
  );
}
