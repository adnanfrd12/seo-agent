"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** A read-only value (e.g. an OAuth redirect URI) with a copy button. */
export function CopyField({ label, value, hint, className }: { label: string; value: string; hint?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    if (!navigator.clipboard) { setCopied("fail"); return; }
    navigator.clipboard.writeText(value).then(() => setCopied("ok"), () => setCopied("fail"));
  };
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-surface-sunken py-1 pl-2.5 pr-1">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">{value}</code>
        <button type="button" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted outline-none transition hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
          {copied === "ok" ? <Check className="size-3.5 text-positive" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
      </div>
      <p role="status" className="sr-only">{copied === "ok" ? "Copied." : copied === "fail" ? "Couldn't copy: select the text and copy it." : ""}</p>
      {copied === "fail" && <p className="mt-1 text-xs text-negative" aria-hidden>Couldn&apos;t copy: select the text and copy it.</p>}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
