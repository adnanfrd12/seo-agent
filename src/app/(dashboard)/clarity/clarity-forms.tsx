"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { addRecordingReview, connectClarity, disconnectClarity, syncClarityNow } from "./actions";

const input = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) { after?.(); router.refresh(); } });
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>;
  return { pending, run, note };
}

export function ConnectClarity({ connected, canEdit }: { connected: boolean; canEdit: boolean }) {
  const [token, setToken] = useState("");
  const { pending, run, note } = useAction();
  if (!canEdit) return <p className="text-sm text-muted">Only owners and admins can manage the Clarity connection.</p>;
  return connected ? (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={pending} onClick={() => run(syncClarityNow)}>{pending && <Loader2 className="size-4 animate-spin" />} Sync now</button>
        <button className={btn2} disabled={pending} onClick={() => { if (confirm("Disconnect Clarity? Stored history is kept.")) run(disconnectClarity); }}>Disconnect</button>
      </div>
      {note}
    </div>
  ) : (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => connectClarity(token), () => setToken("")); }}>
      <label className="block text-sm font-medium">Clarity API token
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={input}
          placeholder="Clarity → Settings → Data Export → Generate new API token" />
      </label>
      <button className={btn} disabled={pending || token.length < 20}>{pending && <Loader2 className="size-4 animate-spin" />} Connect Clarity</button>
      <p className="text-xs text-muted">The token is checked with one API call and stored encrypted. Only a project admin can generate it.</p>
      {note}
    </form>
  );
}

export function ReviewForm() {
  const empty = { page_url: "", recording_url: "", device: "desktop", observed_on: "", friction_type: "rage_clicks", severity: "medium", observation: "" };
  const [f, setF] = useState(empty);
  const { pending, run, note } = useAction();
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => addRecordingReview(f as Parameters<typeof addRecordingReview>[0]), () => setF(empty)); }}>
      <label className="text-sm font-medium">Page URL<input required value={f.page_url} onChange={set("page_url")} className={input} placeholder="https://example.com/contact/" /></label>
      <label className="text-sm font-medium">Recording link (optional)<input value={f.recording_url} onChange={set("recording_url")} className={input} placeholder="https://clarity.microsoft.com/player/…" /></label>
      <label className="text-sm font-medium">What happened
        <select value={f.friction_type} onChange={set("friction_type")} className={input}>
          {[["rage_clicks", "Rage clicks"], ["dead_clicks", "Dead clicks"], ["non_interactive_click", "Clicking non-interactive element"], ["form_friction", "Form friction"],
            ["confusing_navigation", "Confusing navigation"], ["missed_cta", "Important button overlooked"], ["excessive_scroll", "Excessive scrolling without engagement"],
            ["abandonment", "Abandoned at this point"], ["mobile_usability", "Mobile usability problem"], ["broken_cta", "Broken or misleading CTA"], ["error", "Error shown"], ["other", "Other"]]
            .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-sm font-medium">Device<select value={f.device} onChange={set("device")} className={input}><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option><option value="unknown">Unknown</option></select></label>
        <label className="text-sm font-medium">Severity<select value={f.severity} onChange={set("severity")} className={input}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label className="text-sm font-medium">Date<input type="date" value={f.observed_on} onChange={set("observed_on")} className={input} /></label>
      </div>
      <label className="text-sm font-medium sm:col-span-2">Observation
        <textarea required rows={3} maxLength={4000} value={f.observation} onChange={set("observation")} className={input}
          placeholder="e.g. Visitor clicked the hero image 5 times expecting it to open the gallery, then left." />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className={btn} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save observation</button>
        {note}
      </div>
    </form>
  );
}
