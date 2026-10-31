"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { confirmImport, createImportUpload, processImport } from "./actions";

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () => start(async () => {
    if (!file) return;
    setError(null);
    if (file.type && file.type !== "application/pdf") return setError("Only PDF files can be imported.");
    if (file.size > 20 * 1024 * 1024) return setError("The PDF is over 20 MB.");
    setStage("Preparing upload…");
    const up = await createImportUpload(file.name, file.size);
    if (!up.ok) { setStage(null); return setError(up.error); }
    setStage("Uploading…");
    const { error: upErr } = await createClient().storage.from("report-imports").uploadToSignedUrl(up.path, up.token, file, { contentType: "application/pdf" });
    if (upErr) { setStage(null); return setError("Upload failed. Try again."); }
    setStage("Reading the report with AI… this can take a minute");
    const r = await processImport(up.path, file.name);
    setStage(null);
    if (!r.ok) return setError(r.error);
    setFile(null);
    router.push(`/imports?id=${r.id}`);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-border bg-surface p-8 text-center hover:bg-surface-muted">
        <FileUp className="size-8 text-muted" aria-hidden />
        <span className="text-sm font-medium">{file ? file.name : "Choose a PDF report (up to 20 MB)"}</span>
        <span className="text-xs text-muted">Text and image-only (screenshot) PDFs are supported</span>
        <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <button onClick={go} disabled={!file || pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
        {pending && <Loader2 className="size-4 animate-spin" />} {stage ?? "Import and extract"}
      </button>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    </div>
  );
}

type Metric = { id: string; original_label: string; value_text: string | null; source_name: string | null; normalized_metric: string | null; confidence: string | null; page_number: number | null; review_status: string };

export function ReviewTable({ importId, metrics, confirmed }: { importId: string; metrics: Metric[]; confirmed: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Record<string, "accepted" | "rejected">>(
    Object.fromEntries(metrics.map((m) => [m.id, m.review_status === "rejected" ? "rejected" : m.review_status === "accepted" ? "accepted" : m.confidence === "low" ? "rejected" : "accepted"])),
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-[10px] border border-border bg-surface">
        <table className="w-full min-w-[44rem] text-sm">
          <thead><tr className="text-left text-xs text-muted">{["Use", "Label (as written)", "Value", "Source", "Maps to", "Confidence", "Page"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={`Use ${m.original_label}`} disabled={confirmed} checked={d[m.id] === "accepted"}
                    onChange={(e) => setD({ ...d, [m.id]: e.target.checked ? "accepted" : "rejected" })} className="size-4 accent-[var(--accent)]" />
                </td>
                <td className="px-3 py-2">{m.original_label}</td>
                <td className="px-3 py-2 tabular-nums">{m.value_text}</td>
                <td className="px-3 py-2">{m.source_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{m.normalized_metric?.replace(/_/g, " ") ?? "—"}</td>
                <td className="px-3 py-2">{m.confidence}</td>
                <td className="px-3 py-2">{m.page_number ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!confirmed && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending} onClick={() => start(async () => { const r = await confirmImport(importId, d); setMsg(r.ok ? "Saved." : r.error); router.refresh(); })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
            {pending && <Loader2 className="size-4 animate-spin" />} Confirm selection
          </button>
          <p className="text-xs text-muted">Only ticked figures are kept as supporting evidence. They never replace data from the Google or Clarity APIs.</p>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
      )}
    </div>
  );
}
