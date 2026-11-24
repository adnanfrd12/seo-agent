"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Download, Loader2, PlugZap, XCircle } from "lucide-react";
import { importAllData, saveAiSettings, testConnections, type ConnTest } from "@/app/(dashboard)/ai-quick-wins/actions";
import { DFS_FEATURES, EFFORTS, MODELS, type AiQwSettings, type DfsFeature, type ModelId } from "@/lib/aiqw/settings";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}</label>;
}

/** "AI and data" settings: model, effort, budgets, nightly run, DataForSEO features, location, business profile, banned words. */
export function AiSettingsForm({ initial, canEdit, defaults }: { initial: AiQwSettings; canEdit: boolean; defaults: { name: string; phone: string; towns: string } }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof AiQwSettings>(k: K, v: AiQwSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setB = (k: keyof AiQwSettings["business"], v: string) => setS((x) => ({ ...x, business: { ...x.business, [k]: v } }));
  const save = () => start(async () => {
    const r = await saveAiSettings({ ...s, bannedWords: s.bannedWords, emailTo: s.emailTo });
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
  });
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <fieldset disabled={!canEdit || pending} className="grid gap-4 md:grid-cols-2">
        <Field label="Claude model" hint="Opus 5.5: $4 / $20 per million input / output tokens. Sonnet 5.5: $2 / $10. Test both on your own clients.">
          <select className={input} value={s.model} onChange={(e) => set("model", e.target.value as ModelId)}>{(Object.keys(MODELS) as ModelId[]).map((m) => <option key={m} value={m}>{MODELS[m].label}</option>)}</select>
        </Field>
        <Field label="Effort" hint="Medium is the default. Higher effort thinks longer and costs more output tokens.">
          <select className={input} value={s.effort} onChange={(e) => set("effort", e.target.value as AiQwSettings["effort"])}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Monthly Claude budget for this client ($)" hint="A run is refused (with a message) when it would go over.">
          <input type="number" min={0} step={1} className={input} value={s.monthlyBudget} onChange={(e) => set("monthlyBudget", Number(e.target.value))} />
        </Field>
        <Field label="Monthly DataForSEO limit for quick wins ($)" hint="Deep runs, the nightly run and the Keywords screen stop fetching at this amount.">
          <input type="number" min={0} step={1} className={input} value={s.dfsMonthlyBudget} onChange={(e) => set("dfsMonthlyBudget", Number(e.target.value))} />
        </Field>
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={s.nightly} onChange={(e) => set("nightly", e.target.checked)} />
          <span><b>Nightly run</b><span className="block text-xs text-muted">Every night at 02:00 US Central (07:00 UTC) with the Message Batches API (half price); results are collected at 11:00 UTC and the morning email lists the top 5 new quick wins, those resolved, and results of items done 28+ days ago.</span></span>
        </label>
        <Field label="Morning email recipients" hint="Comma separated. Empty = the workspace's owners and admins. Needs RESEND_API_KEY and ALERT_EMAIL_FROM on the server.">
          <input className={input} value={s.emailTo.join(", ")} onChange={(e) => set("emailTo", e.target.value.split(/[,\s]+/).filter(Boolean))} placeholder="owner@business.com" />
        </Field>
      </fieldset>

      <fieldset disabled={!canEdit || pending} className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">DataForSEO features used by quick wins</legend>
        {(Object.keys(DFS_FEATURES) as DfsFeature[]).map((k) => (
          <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={s.dfs[k]} onChange={(e) => set("dfs", { ...s.dfs, [k]: e.target.checked })} /> {DFS_FEATURES[k]}</label>
        ))}
        <div className="grid gap-4 pt-2 md:grid-cols-2">
          <Field label="DataForSEO location" hint='A DataForSEO location name, e.g. "United States" or "Houston,Texas,United States". Empty = the client research target.'><input className={input} value={s.locationName} onChange={(e) => set("locationName", e.target.value)} /></Field>
          <Field label="DataForSEO language code" hint='e.g. "en". Empty = the research target.'><input className={input} value={s.languageCode} onChange={(e) => set("languageCode", e.target.value)} /></Field>
        </div>
      </fieldset>

      <fieldset disabled={!canEdit || pending} className="grid gap-4 md:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold md:col-span-2">Business profile Claude writes for (anything not given becomes a [placeholder])</legend>
        <Field label="Business name" hint={defaults.name ? `Empty = "${defaults.name}" (Business Profile)` : undefined}><input className={input} value={s.business.name} onChange={(e) => setB("name", e.target.value)} placeholder={defaults.name} /></Field>
        <Field label="Phone" hint={defaults.phone ? `Empty = ${defaults.phone}` : undefined}><input className={input} value={s.business.phone} onChange={(e) => setB("phone", e.target.value)} placeholder={defaults.phone} /></Field>
        <Field label="Services"><textarea className={input} rows={2} value={s.business.services} onChange={(e) => setB("services", e.target.value)} placeholder="Channel letters, monument signs, LED displays…" /></Field>
        <Field label="Towns served" hint={defaults.towns ? `Empty = ${defaults.towns}` : undefined}><textarea className={input} rows={2} value={s.business.towns} onChange={(e) => setB("towns", e.target.value)} placeholder={defaults.towns} /></Field>
        <Field label="Certifications and credentials"><input className={input} value={s.business.certifications} onChange={(e) => setB("certifications", e.target.value)} /></Field>
        <Field label="Tone of voice"><input className={input} value={s.business.tone} onChange={(e) => setB("tone", e.target.value)} /></Field>
        <Field label="Banned words" hint='Comma separated, e.g. "free, cheap". Quick wins that use them are rejected.'><input className={input} value={s.bannedWords.join(", ")} onChange={(e) => set("bannedWords", e.target.value.split(",").map((w) => w.trim()).filter(Boolean))} /></Field>
      </fieldset>
      {canEdit && <div className="flex items-center gap-3"><button type="submit" className={btnPrimary} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save settings</button>{msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</span>}</div>}
    </form>
  );
}

/** "Test connections": green/red for every data source, the DataForSEO login and a tiny Claude request. */
export function TestConnections({ canEdit }: { canEdit: boolean }) {
  const [tests, setTests] = useState<ConnTest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <button type="button" className={btn} disabled={!canEdit || pending} onClick={() => start(async () => { setErr(null); const r = await testConnections(); if (r.ok) setTests(r.tests); else setErr(r.error); })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Test connections
      </button>
      {err && <p role="alert" className="text-sm text-negative">{err}</p>}
      {tests && <ul className="grid gap-1.5 sm:grid-cols-2">{tests.map((t) => (
        <li key={t.name} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
          {t.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-label="OK" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-negative" aria-label="Not OK" />}
          <span className="min-w-0"><b>{t.name}</b><span className="block text-xs text-muted">{t.detail}</span></span>
        </li>
      ))}</ul>}
    </div>
  );
}

/** "⬇ Import data": re-sync every source now, then regenerate from the Quick wins page. */
export function ImportData({ canEdit }: { canEdit: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <button type="button" className={btn} disabled={!canEdit || pending} onClick={() => start(async () => { const r = await importAllData(); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Import data
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text} {msg.ok && <a href="/ai-quick-wins" className="underline">Regenerate quick wins</a>}</p>}
    </div>
  );
}
