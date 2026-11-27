"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIENT_ROLE_LABEL, type ClientRoleId } from "./labels";
import { btn, input } from "./styles";

export type ActionResult = { ok: true; message?: string; link?: string; emailed?: boolean; id?: string } | { ok: false; error: string };

export function Status({ result, className }: { result: ActionResult | null; className?: string }) {
  if (!result) return null;
  return result.ok
    ? result.message ? <p role="status" className={cn("text-sm text-positive", className)}>{result.message}</p> : null
    : <p role="alert" className={cn("text-sm text-negative", className)}>{result.error}</p>;
}

/** Warns before leaving the page (reload, close, typed URL) while a form has unsaved changes. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);
}

/** Save / discard row with the unsaved-changes indicator. */
export function SaveBar({ dirty, pending, onDiscard, result, label = "Save changes" }: {
  dirty: boolean; pending: boolean; onDiscard: () => void; result: ActionResult | null; label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
      <button type="submit" className={btn.primary} disabled={!dirty || pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} {label}
      </button>
      {dirty && <button type="button" className={btn.ghost} onClick={onDiscard} disabled={pending}>Discard</button>}
      <span aria-live="polite" className="text-sm">
        {dirty
          ? <span className="inline-flex items-center gap-1.5 text-warn"><span className="size-1.5 rounded-full bg-warn" aria-hidden /> Unsaved changes</span>
          : <Status result={result} />}
      </span>
    </div>
  );
}

/** A one-time link with a copy button (invitation links are shown only right after they're made). */
export function CopyLink({ link, note }: { link: string; note?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { field.current?.select(); }
  }
  return (
    <div className="rounded-lg border border-border bg-surface-sunken p-3">
      {note && <p className="text-xs leading-relaxed text-secondary">{note}</p>}
      <div className="mt-2 flex gap-2">
        <input ref={field} readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()}
          className={cn(input, "mt-0 min-w-0 font-mono text-xs")} />
        <button type="button" onClick={copy} className={cn(btn.secondary, "shrink-0")}>
          {copied ? <Check className="size-4 text-positive" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export interface PickRow { id: string; label: string; sub?: string; locked?: string; /** this row's choices when they differ (e.g. viewers: view only) */ roles?: ClientRoleId[] }

/**
 * A searchable checklist that gives each picked row a client role (client access per member, or members per client).
 * `roles` with a single entry hides the role menu. A `locked` row shows why it can't be changed here.
 */
export function AccessPicker({ rows, value, onChange, roles, defaultRole, disabled, noun }: {
  rows: PickRow[]; value: Record<string, ClientRoleId>; onChange: (v: Record<string, ClientRoleId>) => void;
  roles: ClientRoleId[]; defaultRole: ClientRoleId; disabled?: boolean; noun: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.label} ${r.sub ?? ""}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const picked = Object.keys(value).length;
  const set = (id: string, role: ClientRoleId | null) => {
    const next = { ...value };
    if (role) next[id] = role; else delete next[id];
    onChange(next);
  };
  const free = shown.filter((r) => !r.locked);
  const first = (r: PickRow) => (r.roles && !r.roles.includes(defaultRole) ? r.roles[0] : defaultRole);
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search {noun}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun}`} disabled={disabled}
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/30" />
        </label>
        <button type="button" className={btn.ghost} disabled={disabled || !free.length}
          onClick={() => onChange({ ...value, ...Object.fromEntries(free.filter((r) => !value[r.id]).map((r) => [r.id, first(r)])) })}>
          Select {q ? "shown" : "all"}
        </button>
        <button type="button" className={btn.ghost} disabled={disabled || !picked}
          onClick={() => { const next = { ...value }; for (const r of free) delete next[r.id]; onChange(next); }}>
          Clear
        </button>
      </div>
      <ul className="max-h-72 divide-y divide-hairline overflow-y-auto">
        {shown.length === 0 && <li className="p-3 text-sm text-muted">Nothing matches.</li>}
        {shown.map((r) => {
          const role = value[r.id];
          const choices = r.roles ?? roles;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={Boolean(role)} disabled={disabled || Boolean(r.locked)}
                  onChange={(e) => set(r.id, e.target.checked ? first(r) : null)} className="size-4 shrink-0 accent-[var(--accent)]" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.label}</span>
                  {(r.sub || r.locked) && <span className="block truncate text-xs text-muted">{r.locked ?? r.sub}</span>}
                </span>
              </label>
              {role && choices.length > 1 && !r.locked && (
                <select value={role} disabled={disabled} onChange={(e) => set(r.id, e.target.value as ClientRoleId)} aria-label={`Role for ${r.label}`}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
                  {Array.from(new Set([role, ...choices])).map((x) => <option key={x} value={x}>{CLIENT_ROLE_LABEL[x]}</option>)}
                </select>
              )}
              {role && (choices.length === 1 || r.locked) && <span className="text-xs text-muted">{CLIENT_ROLE_LABEL[role]}</span>}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-hairline px-3 py-2 text-xs text-muted">{picked} selected</p>
    </div>
  );
}
