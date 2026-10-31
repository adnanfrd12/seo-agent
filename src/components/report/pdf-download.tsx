"use client";

import { useState } from "react";
import { FileText, Loader2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Downloads the server-rendered PDF. Checks the response first, so a server error is shown as a
 * message with a one-click print fallback instead of being saved as a stray .json file.
 */
export function PdfDownloadButton({
  href, printHref, label, primary = false, filename, menu = false,
}: { href: string; printHref: string; label: string; primary?: boolean; filename: string; menu?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("application/pdf")) {
        const body = type.includes("json") ? await res.json().catch(() => null) : null;
        throw new Error(body?.error ?? `The PDF couldn't be generated (HTTP ${res.status}).`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The PDF couldn't be generated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex flex-col">
      <button onClick={download} disabled={busy} aria-busy={busy} role={menu ? "menuitem" : undefined}
        className={cn("inline-flex items-center gap-2 font-medium disabled:opacity-70",
          menu ? "w-full rounded-md px-2.5 py-1.5 text-left text-[13px] font-normal hover:bg-surface-muted"
            : primary ? "h-9 rounded-md bg-accent px-3.5 text-sm text-accent-foreground hover:opacity-90" : "h-9 rounded-md border border-border-strong bg-surface px-3.5 text-sm hover:bg-surface-muted")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className={cn("size-4", menu && "text-muted")} aria-hidden />}
        {busy ? "Generating PDF…" : label}
      </button>
      {error && (
        <span role="alert" className={cn("z-20 w-72 rounded-lg border border-border bg-surface p-3 text-left text-xs shadow-lg", menu ? "mt-1" : "absolute right-0 top-full mt-2")}>
          <span className="block text-negative">{error}</span>
          <a href={printHref} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2">
            <Printer className="size-3.5" aria-hidden /> Open print view and choose “Save as PDF”
          </a>
          <button onClick={() => setError(null)} className="ml-3 text-muted hover:text-foreground">Dismiss</button>
        </span>
      )}
    </span>
  );
}
