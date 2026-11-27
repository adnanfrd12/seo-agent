"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { deleteCustomVariable, saveCustomVariable } from "@/app/(dashboard)/integrations/credential-actions";
import { cn } from "@/lib/utils";
import { btn } from "./credential-card";
import { checkCustomKey, checkCustomValue, MAX_VALUE, toKey } from "./field-rules";
import { IntegrationLogo } from "./integration-logo";
import type { CustomVarView } from "./types";

const input = "w-full rounded-lg border border-border-strong bg-surface px-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-negative disabled:cursor-not-allowed disabled:opacity-60";
const iconBtn = "grid size-8 place-items-center rounded-lg text-muted outline-none transition hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

function VariableDialog({ open, orgId, existing, onClose, onSaved }: {
  open: boolean; orgId: string; existing: CustomVarView | null; onClose: () => void; onSaved: (message: string) => void;
}) {
  const uid = useId();
  const [key, setKey] = useState(existing?.key ?? "");
  // a non-secret value is shown to owners and can be edited in place; a secret one is always typed again
  const [value, setValue] = useState(existing && !existing.secret ? existing.display ?? "" : "");
  const [secret, setSecret] = useState(existing?.secret ?? true);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ key?: string; value?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const k = key.trim();
    const v = value.trim();
    const next = { key: existing ? undefined : checkCustomKey(k) ?? undefined, value: checkCustomValue(v) ?? undefined };
    setErrors(next);
    if (next.key || next.value) { setFormError(null); document.getElementById(`${uid}-${next.key ? "key" : "value"}`)?.focus(); return; }
    start(async () => {
      try {
        const r = await saveCustomVariable(orgId, k, v, secret);
        if (r.ok) { onSaved(r.message); return; }
        setErrors(r.fields ?? {});
        setFormError(r.error);
      } catch {
        setFormError("Couldn't save. Check your connection and try again.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} busy={pending} icon={<IntegrationLogo id="custom" />}
      title={existing ? `Edit ${existing.key}` : "Add a custom variable"}
      description="An extra configuration value for this organization, encrypted like every credential.">
      <form onSubmit={submit} noValidate>
        <DialogBody className="space-y-4">
          <div>
            <label htmlFor={`${uid}-key`} className="text-[13px] font-medium text-foreground">Name<span className="ml-0.5 text-negative" aria-hidden>*</span></label>
            <input id={`${uid}-key`} data-autofocus={existing ? undefined : true} value={key} readOnly={Boolean(existing)} disabled={pending}
              onChange={(e) => { setKey(toKey(e.target.value)); setErrors((er) => ({ ...er, key: undefined })); }}
              placeholder="MY_SETTING" maxLength={81} autoComplete="off" spellCheck={false} aria-required
              aria-invalid={Boolean(errors.key)} aria-describedby={`${uid}-key-help${errors.key ? ` ${uid}-key-error` : ""}`}
              className={cn(input, "h-9", existing && "bg-surface-sunken text-secondary")} />
            <p id={`${uid}-key-help`} className="mt-1 text-xs text-muted">{existing ? "To rename a variable, add a new one and delete this one." : "Capital letters, digits and underscores, starting with a letter."}</p>
            {errors.key && <p id={`${uid}-key-error`} className="mt-1 text-xs font-medium text-negative">{errors.key}</p>}
          </div>
          <div>
            <label htmlFor={`${uid}-value`} className="text-[13px] font-medium text-foreground">Value<span className="ml-0.5 text-negative" aria-hidden>*</span></label>
            <div className="relative mt-1">
              {secret ? (
                <input id={`${uid}-value`} data-autofocus={existing ? true : undefined} type={show ? "text" : "password"} value={value} disabled={pending}
                  onChange={(e) => { setValue(e.target.value); setErrors((er) => ({ ...er, value: undefined })); }}
                  placeholder={existing ? "Enter the new value" : ""} maxLength={MAX_VALUE} autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" aria-required
                  aria-invalid={Boolean(errors.value)} aria-describedby={errors.value ? `${uid}-value-error` : undefined} className={cn(input, "h-9 pr-10")} />
              ) : (
                <textarea id={`${uid}-value`} data-autofocus={existing ? true : undefined} value={value} disabled={pending} rows={3}
                  onChange={(e) => { setValue(e.target.value); setErrors((er) => ({ ...er, value: undefined })); }}
                  maxLength={MAX_VALUE} spellCheck={false} aria-required aria-invalid={Boolean(errors.value)} aria-describedby={errors.value ? `${uid}-value-error` : undefined}
                  className={cn(input, "py-2 leading-relaxed")} />
              )}
              {secret && (
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide value" : "Show value"} aria-pressed={show}
                  className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
                  {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              )}
            </div>
            {errors.value && <p id={`${uid}-value-error`} className="mt-1 text-xs font-medium text-negative">{errors.value}</p>}
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-secondary">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={secret} disabled={pending}
              onChange={(e) => setSecret(e.target.checked)} />
            <span><span className="font-medium text-foreground">Secret</span>: only the last characters are shown after saving. Turn off for plain settings (e.g. an ID or a URL).</span>
          </label>
          <p className="flex items-start gap-1.5 text-xs text-muted"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Stored encrypted. Changes apply within 30 seconds.</p>
          {formError && <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative">{formError}</p>}
        </DialogBody>
        <DialogFooter>
          <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className={dialogBtn.primary} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} {pending ? "Saving…" : existing ? "Save" : "Add variable"}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Custom variables: arbitrary UPPER_SNAKE configuration values for the organization (owners edit; admins see names). */
export function CustomVariables({ orgId, vars, canEdit }: { orgId: string; vars: CustomVarView[]; canEdit: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [editor, setEditor] = useState<{ open: boolean; n: number; existing: CustomVarView | null }>({ open: false, n: 0, existing: null });
  const [toDelete, setToDelete] = useState<CustomVarView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const open = (existing: CustomVarView | null) => { setNotice(null); setEditor((e) => ({ open: true, n: e.n + 1, existing })); };
  const remove = () => startDelete(async () => {
    if (!toDelete) return;
    setDeleteError(null);
    try {
      const r = await deleteCustomVariable(orgId, toDelete.key);
      if (!r.ok) { setDeleteError(r.error); return; }
      setToDelete(null);
      setNotice(r.message);
      router.refresh();
    } catch {
      setDeleteError("Couldn't delete. Check your connection and try again.");
    }
  });

  return (
    <article className="flex h-full min-w-0 flex-col rounded-[10px] border border-border bg-surface" aria-labelledby={`${uid}-title`}>
      <header className="flex items-start gap-3 px-4 pt-4">
        <IntegrationLogo id="custom" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 id={`${uid}-title`} className="text-[15px] font-semibold leading-snug">Custom variables</h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-secondary">{vars.length} saved</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">Other</p>
        </div>
      </header>
      <div className="flex-1 space-y-3 px-4 pb-4 pt-3 text-sm">
        <p className="leading-relaxed text-secondary">Extra configuration values for this organization (names like MY_SETTING), encrypted like every credential.</p>
        {vars.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-[13px] text-muted">No custom variables yet.</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline">
            {vars.map((v) => (
              <li key={v.key} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] font-medium text-foreground">{v.key}</p>
                  <p className="truncate text-xs text-muted">
                    {v.display ? <span className="font-mono">{v.display}</span> : v.secret ? "Secret" : "Saved"}
                    {v.updated && <> · {v.updated}</>}
                  </p>
                </div>
                {canEdit && (
                  <>
                    <button type="button" className={iconBtn} onClick={() => open(v)} aria-label={`Edit ${v.key}`} title="Edit"><Pencil className="size-4" aria-hidden /></button>
                    <button type="button" className={cn(iconBtn, "hover:bg-negative-soft hover:text-negative")} onClick={() => { setDeleteError(null); setToDelete(v); }} aria-label={`Delete ${v.key}`} title="Delete"><Trash2 className="size-4" aria-hidden /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {notice && <p role="status" className="text-[13px] text-positive">{notice}</p>}
      </div>
      {canEdit && (
        <footer className="border-t border-hairline px-4 py-3">
          <button type="button" className={btn} onClick={() => open(null)}><Plus className="size-3.5" aria-hidden /> Add variable</button>
        </footer>
      )}
      {canEdit && (
        <VariableDialog key={editor.n} open={editor.open} orgId={orgId} existing={editor.existing}
          onClose={() => setEditor((e) => ({ ...e, open: false }))}
          onSaved={(m) => { setEditor((e) => ({ ...e, open: false })); setNotice(m); router.refresh(); }} />
      )}
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} onConfirm={remove} busy={deleting} error={deleteError}
        title={`Delete ${toDelete?.key ?? "this variable"}?`} confirmLabel="Delete variable"
        icon={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-negative-soft text-negative"><Trash2 className="size-5" aria-hidden /></span>}>
        <p>Anything in this organization that reads {toDelete?.key ?? "it"} stops getting a value. This can&apos;t be undone.</p>
      </ConfirmDialog>
    </article>
  );
}
