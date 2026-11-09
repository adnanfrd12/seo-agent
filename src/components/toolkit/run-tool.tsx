"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { runToolkit, type ToolSlug } from "@/app/(dashboard)/toolkit/actions";

/** Owner/admin run button for an SEO Toolkit tool, with an optional text input (URL or keyword). */
export function RunTool({ slug, canEdit, label, cost, wait, input }: {
  slug: ToolSlug; canEdit: boolean; label: string; cost: string; wait: string;
  input?: { placeholder: string; defaultValue?: string; name: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(input?.defaultValue ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return <p className="text-xs text-muted">Only owners and admins can run this tool.</p>;
  return (
    <form className="w-full space-y-1.5 sm:w-auto" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setMsg(null);
        const r = await runToolkit(slug, value);
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        router.refresh();
      });
    }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {input && (
          <label className="min-w-0 flex-1">
            <span className="sr-only">{input.name}</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={input.placeholder}
              className="h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm sm:w-80" />
          </label>
        )}
        <button type="submit" disabled={pending} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {label} <span className="opacity-70">({cost})</span>
        </button>
      </div>
      {pending && <p className="text-xs text-muted">{wait}</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`max-w-xl break-words text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </form>
  );
}
