"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileStack, Printer } from "lucide-react";
import { PdfDownloadButton } from "./pdf-download";

/** One "Export" button for the Overview: the full report PDF, the executive summary PDF, the print view and the on-screen full report. */
export function ExportMenu({ fullPdf, execPdf, fullPrint, execPrint, reportPage, fileBase }: {
  fullPdf: string; execPdf: string; fullPrint: string; execPrint: string; reportPage: string; fileBase: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
        Export <ChevronDown className="size-4 opacity-80" aria-hidden />
      </button>
      {/* kept mounted while a PDF is generating, so its progress and any error stay visible */}
      <div role="menu" hidden={!open} className="absolute right-0 z-40 mt-1.5 w-64 rounded-lg border border-border bg-surface p-1.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]">
        <PdfDownloadButton menu href={fullPdf} printHref={fullPrint} label="Full report PDF" filename={`${fileBase}-full-report.pdf`} />
        <PdfDownloadButton menu href={execPdf} printHref={execPrint} label="Executive summary PDF" filename={`${fileBase}-executive-summary.pdf`} />
        <div className="my-1 border-t border-hairline" />
        <Link role="menuitem" href={fullPrint} target="_blank" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-muted">
          <Printer className="size-4 text-muted" aria-hidden /> Print report
        </Link>
        <Link role="menuitem" href={reportPage} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-muted">
          <FileStack className="size-4 text-muted" aria-hidden /> View full report on screen
        </Link>
      </div>
    </div>
  );
}
