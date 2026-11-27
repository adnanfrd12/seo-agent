"use client";

import { useId, useState, useTransition } from "react";
import { ExternalLink, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { saveIntegrationCredentials } from "@/app/(dashboard)/integrations/credential-actions";
import { cn } from "@/lib/utils";
import { CopyField } from "./copy-field";
import { checkValue, normalizeValue } from "./field-rules";
import { IntegrationLogo } from "./integration-logo";
import type { FieldView, IntegrationView } from "./types";

const input = "h-9 w-full rounded-lg border border-border-strong bg-surface px-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-negative disabled:cursor-not-allowed disabled:opacity-60";
const link = "inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground";

/** Non-secret values (logins, client IDs, config IDs) are shown and edited in place; secrets start empty. */
const initialOf = (f: FieldView) => (!f.secret && f.display ? f.display : "");

/**
 * Add / edit an integration's credentials (owners). Secrets are never shown: a saved secret is described
 * by its masked hint, and leaving its field empty keeps it. The caller gives it a new `key` for every opening,
 * so each one starts from the saved state.
 */
export function CredentialDialog({ open, view, orgId, orgName, onClose, onSaved }: {
  open: boolean; view: IntegrationView; orgId: string; orgName: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const uid = useId();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(view.fields.map((f) => [f.key, initialOf(f)])));
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const configured = view.fields.some((f) => f.set);

  const toggle = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n; };
  const focusFirst = (key: string | undefined) => { if (key) document.getElementById(`${uid}-${key}`)?.focus(); };
  const clearError = (key: string) => setErrors((er) => { if (!(key in er)) return er; const n = { ...er }; delete n[key]; return n; });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const nextErrors: Record<string, string> = {};
    const changes: Record<string, string | null> = {};
    for (const f of view.fields) {
      if (remove.has(f.key)) { changes[f.key] = null; continue; }
      const v = normalizeValue(f.key, values[f.key] ?? "");
      if (!v) { if (f.required && !f.set) nextErrors[f.key] = "Required."; continue; }
      if (v === initialOf(f)) continue;
      const problem = checkValue(f.key, v);
      if (problem) nextErrors[f.key] = problem; else changes[f.key] = v;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setFormError("Check the highlighted fields."); focusFirst(Object.keys(nextErrors)[0]); return; }
    if (!Object.keys(changes).length) { setFormError("Nothing changed: enter a new value, or close."); return; }
    setFormError(null);
    start(async () => {
      try {
        const r = await saveIntegrationCredentials(orgId, view.id, changes);
        if (r.ok) { onSaved(r.message); return; }
        setErrors(r.fields ?? {});
        setFormError(r.error);
        if (r.fields) focusFirst(Object.keys(r.fields)[0]);
      } catch {
        setFormError("Couldn't save. Check your connection and try again.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} busy={pending} icon={<IntegrationLogo id={view.id} />}
      title={`${configured ? "Edit" : "Add"} ${view.name}`}
      description={<>Saved for <span className="font-medium text-foreground">{orgName}</span> and used for all of its clients.</>}>
      <form onSubmit={submit} noValidate>
        <DialogBody className="space-y-4">
          {view.redirectUri && (
            <CopyField label="Authorized redirect URI" value={view.redirectUri} hint="Add it to the OAuth client in Google Cloud (APIs & Services → Credentials) before connecting. If you save a different redirect URI below, register that one instead." />
          )}
          {view.fields.map((f, i) => {
            const id = `${uid}-${f.key}`;
            const removing = remove.has(f.key);
            const isShown = shown.has(f.key);
            const savedNote = f.source === "env" ? "From the server environment" : f.set ? (f.secret ? `Saved ${f.display ?? ""}`.trim() : "Saved") : null;
            return (
              <div key={f.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <label htmlFor={id} className="text-[13px] font-medium text-foreground">
                    {f.label}
                    {f.required ? <span className="ml-0.5 text-negative" aria-hidden>*</span> : <span className="ml-1 font-normal text-muted">(optional)</span>}
                  </label>
                  {savedNote && <span className="text-xs text-muted">{savedNote}</span>}
                </div>
                <div className="relative mt-1">
                  <input
                    id={id} name={f.key} data-autofocus={i === 0 ? true : undefined}
                    type={f.secret && !isShown ? "password" : "text"}
                    autoComplete={f.secret ? "new-password" : "off"} spellCheck={false} autoCapitalize="off" data-1p-ignore data-lpignore="true"
                    value={values[f.key] ?? ""} disabled={removing || pending}
                    onChange={(e) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); clearError(f.key); }}
                    placeholder={f.secret && f.set ? "Leave empty to keep the saved value" : f.placeholder ?? ""}
                    required={f.required && !f.set} aria-required={f.required}
                    aria-invalid={Boolean(errors[f.key])}
                    aria-describedby={[f.help && `${id}-help`, errors[f.key] && `${id}-error`].filter(Boolean).join(" ") || undefined}
                    className={cn(input, f.secret && "pr-10")}
                  />
                  {f.secret && (
                    <button type="button" onClick={() => setShown((s) => toggle(s, f.key))} aria-label={isShown ? `Hide ${f.label}` : `Show ${f.label}`} aria-pressed={isShown}
                      className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
                      {isShown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  )}
                </div>
                {f.help && <p id={`${id}-help`} className="mt-1 text-xs text-muted">{f.help}</p>}
                {errors[f.key] && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-negative">{errors[f.key]}</p>}
                {!f.required && f.source === "org" && (
                  <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 text-xs text-secondary">
                    <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={removing} disabled={pending} onChange={() => setRemove((s) => toggle(s, f.key))} />
                    Remove the saved value
                  </label>
                )}
              </div>
            );
          })}
          {(view.consoleUrl || view.docsUrl) && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <span className="text-muted">Where to get it:</span>
              {view.consoleUrl && <a href={view.consoleUrl} target="_blank" rel="noopener noreferrer" className={link}>Open the console <ExternalLink className="size-3" aria-hidden /></a>}
              {view.docsUrl && <a href={view.docsUrl} target="_blank" rel="noopener noreferrer" className={link}>Documentation <ExternalLink className="size-3" aria-hidden /></a>}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Values are encrypted before they&apos;re stored, can&apos;t be read back, and apply within 30 seconds. Leave a secret empty to keep the saved one.
          </p>
          {formError && <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative">{formError}</p>}
        </DialogBody>
        <DialogFooter>
          <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className={dialogBtn.primary} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} {pending ? "Saving…" : view.testable ? "Save and test" : "Save"}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
