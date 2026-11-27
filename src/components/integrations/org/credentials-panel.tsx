"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, CheckCircle2, ChevronDown, Download, Loader2, PlugZap, Search, Trash2, XCircle, AlertTriangle } from "lucide-react";
import { deleteIntegrationField, setIntegrationField, testIntegrationConnection } from "@/app/(dashboard)/integrations/credential-actions";
import { ConfirmDialog } from "@/components/dashboard/dialog";
import type { GuideContext } from "@/lib/org/guides";
import type { TestStatus } from "@/lib/org/tests";
import { CATEGORIES, type IntegrationCategory } from "@/lib/org/registry";
import { cn } from "@/lib/utils";
import { CopyField } from "./copy-field";
import { CustomVariables } from "./custom-variables";
import { GuidePanel } from "./credential-card";
import { IntegrationLogo } from "./integration-logo";
import type { CustomVarView, FieldView, IntegrationView } from "./types";

const inputCls = "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-[13px] text-foreground outline-none transition placeholder:font-sans placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:opacity-60";
const btn = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-foreground outline-none transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary = "inline-flex h-9 w-[84px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const linkCls = "inline-flex items-center gap-1 text-[13px] text-secondary underline decoration-border-strong underline-offset-2 hover:text-foreground";

/** configured / partly configured / not configured, as a small dot + word */
function StatusPill({ status }: { status: IntegrationView["status"] }) {
  const s = status === "configured" || status === "connected" ? { dot: "bg-positive", text: "Configured" }
    : status === "partial" ? { dot: "bg-warn", text: "Incomplete" } : { dot: "bg-border-strong", text: "Not configured" };
  return <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-secondary"><span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />{s.text}</span>;
}

/** Composio's many fields in smaller groups; optional fields of other integrations stay folded. */
function fieldGroups(v: IntegrationView): { title: string | null; fields: FieldView[]; open: boolean }[] {
  if (v.id === "composio") {
    const core = v.fields.filter((f) => f.key === "COMPOSIO_API_KEY");
    const google = v.fields.filter((f) => /AUTH_CONFIG_(GA4|GSC)$/.test(f.key));
    const advanced = v.fields.filter((f) => f.key.startsWith("COMPOSIO_TOOLKIT_VERSION_"));
    const social = v.fields.filter((f) => !core.includes(f) && !google.includes(f) && !advanced.includes(f));
    return [
      { title: "Core API credentials", fields: core, open: true },
      { title: "Google authentication configurations", fields: google, open: true },
      { title: "Social media authentication configurations", fields: social, open: social.some((f) => f.set) },
      { title: "Advanced settings", fields: advanced, open: advanced.some((f) => f.set) },
    ].filter((g) => g.fields.length);
  }
  const required = v.fields.filter((f) => f.required), optional = v.fields.filter((f) => !f.required);
  if (!required.length) return [{ title: null, fields: optional, open: true }];
  return [{ title: null, fields: required, open: true }, ...(optional.length ? [{ title: `Optional fields (${optional.length})`, fields: optional, open: optional.some((f) => f.set) }] : [])];
}

function FieldRow({ orgId, integrationId, field, canEdit, onDelete }: {
  orgId: string; integrationId: string; field: FieldView; canEdit: boolean; onDelete: (f: FieldView) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fromEnv = field.source === "env";
  const placeholder = field.set
    ? `${field.display ?? "••••••••"}${fromEnv ? "  (server environment)" : ""}  · enter a new value to replace`
    : field.placeholder ?? `Enter ${field.label.toLowerCase()}`;
  const save = () => start(async () => {
    setMsg(null);
    const r = await setIntegrationField(orgId, integrationId, field.key, value);
    setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    if (r.ok) { setValue(""); router.refresh(); }
  });
  return (
    <div className="grid gap-1.5 py-2.5 xl:grid-cols-[190px_minmax(0,1fr)] xl:items-start xl:gap-4">
      <div className="text-[13px] xl:pt-2">
        <span className="font-medium text-foreground">{field.label}</span>
        {field.required && <span className="ml-0.5 text-negative" aria-hidden>*</span>}
        <span className={cn("mt-0.5 flex items-center gap-1 text-xs", field.set ? "text-positive" : "text-muted")}>
          {field.set ? <><Check className="size-3" aria-hidden /> {fromEnv ? "Set (server)" : "Saved"}</> : field.required ? "Missing" : "Not set"}
        </span>
      </div>
      <div className="min-w-0">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) save(); }}>
          <input aria-label={field.label} value={value} onChange={(e) => { setValue(e.target.value); setMsg(null); }} disabled={!canEdit || pending}
            type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false} placeholder={canEdit ? placeholder : field.set ? "Saved" : "Not set"} className={inputCls} />
          {canEdit && (
            <>
              <button className={btnPrimary} disabled={pending || !value.trim()}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : field.set ? "Update" : "Set"}
              </button>
              <button type="button" onClick={() => onDelete(field)} disabled={pending || field.source !== "org"} aria-label={`Delete ${field.label}`}
                title={field.source === "org" ? "Delete" : "Nothing saved here"} className={cn(btn, "w-9 px-0 hover:text-negative")}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            </>
          )}
        </form>
        {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-1 text-xs", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
        {!msg && field.help && <p className="mt-1 text-xs text-muted">{field.help}</p>}
      </div>
    </div>
  );
}

const TEST_ICON: Record<TestStatus, { icon: typeof CheckCircle2; cls: string }> = {
  ok: { icon: CheckCircle2, cls: "text-positive" }, warning: { icon: AlertTriangle, cls: "text-warn" }, error: { icon: XCircle, cls: "text-negative" },
};

function IntegrationRow({ v, orgId, canEdit, canTest, guideContext, pdfHref, open, onToggle, onDelete }: {
  v: IntegrationView; orgId: string; canEdit: boolean; canTest: boolean; guideContext: GuideContext; pdfHref: string;
  open: boolean; onToggle: () => void; onDelete: (v: IntegrationView, f: FieldView) => void;
}) {
  const [guide, setGuide] = useState(false);
  const [test, setTest] = useState<{ status: TestStatus; message: string } | null>(null);
  const [testing, start] = useTransition();
  const ready = v.fields.filter((f) => f.required).every((f) => f.set) && v.fields.some((f) => f.set);
  const T = test ? TEST_ICON[test.status] : null;
  return (
    <li id={`credential-${v.id}`} className="scroll-mt-4">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition hover:bg-surface-muted/60 focus-visible:bg-surface-muted">
        <IntegrationLogo id={v.id} className="size-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{v.name}</span>
          <span className="block truncate text-xs text-muted">{v.description.split(/(?<=\.)\s/)[0]}</span>
        </span>
        <StatusPill status={v.status} />
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-hairline bg-surface-sunken/40 px-4 pb-4 pt-1">
          {fieldGroups(v).map((g, i) => {
            const rows = <div className="divide-y divide-hairline">{g.fields.map((f) => <FieldRow key={f.key} orgId={orgId} integrationId={v.id} field={f} canEdit={canEdit} onDelete={(x) => onDelete(v, x)} />)}</div>;
            return g.title ? (
              <details key={i} open={g.open} className="group mt-2 rounded-lg border border-hairline bg-surface px-3">
                <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                  {g.title}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                {rows}
              </details>
            ) : <div key={i}>{rows}</div>;
          })}
          {v.redirectUri && <CopyField className="mt-3" label="OAuth redirect URI" value={v.redirectUri} hint="Add this exact address to the provider's allowed redirect URIs." />}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {v.testable && canTest && (
              <button type="button" className={btn} disabled={!ready || testing} onClick={() => start(async () => {
                setTest(null);
                try { setTest(await testIntegrationConnection(orgId, v.id)); } catch { setTest({ status: "error", message: "Couldn't run the test. Try again." }); }
              })} title={ready ? undefined : "Set the required fields first"}>
                {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />} Test connection
              </button>
            )}
            <button type="button" className={linkCls} onClick={() => setGuide((x) => !x)} aria-expanded={guide}><BookOpen className="size-3.5" aria-hidden /> Setup instructions</button>
            <a className={linkCls} href={pdfHref}><Download className="size-3.5" aria-hidden /> PDF guide</a>
            {v.updated && <span className="text-xs text-muted">Updated {v.updated}</span>}
          </div>
          {T && test && (
            <p role="status" className={cn("mt-2 flex items-start gap-1.5 text-xs", T.cls)}>
              <T.icon className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>{test.status === "ok" ? "Verified: " : ""}{test.message}</span>
            </p>
          )}
          {guide && (
            <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-lg border border-hairline bg-surface p-4">
              <GuidePanel id={v.id} context={guideContext} fallback={<p className="text-sm text-muted">No guide for this integration yet.</p>} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Settings → Organization → Integrations: compact, collapsible sections per category; each credential is entered
 * and saved on its own (Enter → Set). Values are never sent back: saved secrets show as a masked placeholder.
 */
export function CredentialsPanel({ orgId, integrations, custom, canEdit, canTest, guideContext, pdfFor, banner, clientConnections }: {
  orgId: string; integrations: IntegrationView[]; custom: CustomVarView[]; canEdit: boolean; canTest: boolean; guideContext: GuideContext;
  pdfFor: Record<string, string> & { all: string }; banner?: React.ReactNode;
  clientConnections: { id: string; name: string; connected: number }[]; clientCount?: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<IntegrationCategory | "all">("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ v: IntegrationView; f: FieldView } | null>(null);
  const [deleting, startDelete] = useTransition();
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const creds = integrations.filter((i) => !i.perClient);
  const configured = creds.filter((i) => i.status === "configured").length;
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => creds.filter((i) => (cat === "all" || i.category === cat) && (!term || i.search.includes(term) || i.fields.some((f) => f.label.toLowerCase().includes(term) || f.key.toLowerCase().includes(term)))), [creds, cat, term]);
  const cats = CATEGORIES.filter((c) => creds.some((i) => i.category === c.id));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Integrations</h2>
          <p className="mt-0.5 text-sm text-secondary">API credentials used for every client of this organization. Encrypted, never shown again; only owners can change them.</p>
        </div>
        <a href={pdfFor.all} className={cn(btn, "border-accent/40 text-accent")}><Download className="size-4" aria-hidden /> Download complete setup guide (PDF)</a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations, keys or features" aria-label="Search integrations" className={cn(inputCls, "pl-9 font-sans")} />
        </label>
        <span className="text-xs text-secondary"><span className="font-semibold text-positive">{configured}</span> configured · <span className="font-semibold text-foreground">{creds.length - configured}</span> not configured</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
        {[{ id: "all" as const, label: "All", n: creds.length }, ...cats.map((c) => ({ id: c.id, label: c.label, n: creds.filter((i) => i.category === c.id).length }))].map((c) => (
          <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
            className={cn("h-7 rounded-full border px-3 text-xs font-medium transition", cat === c.id ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-secondary hover:text-foreground")}>
            {c.label} <span className="opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      {banner}

      {(cat === "all" ? cats : cats.filter((c) => c.id === cat)).map((c) => {
        const items = shown.filter((i) => i.category === c.id);
        if (!items.length) return null;
        return (
          <section key={c.id} aria-label={c.label}>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</h3>
              <button type="button" className="text-xs text-secondary hover:text-foreground"
                onClick={() => setOpen((s) => { const n = new Set(s); const all = items.every((i) => n.has(i.id)); items.forEach((i) => (all ? n.delete(i.id) : n.add(i.id))); return n; })}>
                {items.every((i) => open.has(i.id)) ? "Collapse all" : "Expand all"}
              </button>
            </div>
            <ul className="divide-y divide-hairline overflow-hidden rounded-[10px] border border-border bg-surface">
              {items.map((v) => (
                <IntegrationRow key={v.id} v={v} orgId={orgId} canEdit={canEdit} canTest={canTest} guideContext={guideContext}
                  pdfHref={pdfFor[v.id] ?? pdfFor.all} open={open.has(v.id) || Boolean(term)} onToggle={() => toggle(v.id)} onDelete={(iv, f) => { setDeleteMsg(null); setConfirm({ v: iv, f }); }} />
              ))}
            </ul>
          </section>
        );
      })}
      {!shown.length && <p className="rounded-[10px] border border-border bg-surface p-4 text-sm text-muted">No integration matches. <button type="button" className="underline" onClick={() => { setQ(""); setCat("all"); }}>Clear the filter</button></p>}
      {deleteMsg && <p role="status" className="text-sm text-secondary">{deleteMsg}</p>}

      <section aria-label="Client connections">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Client connections</h3>
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3">
          <p className="text-sm text-secondary">Each client connects its own Google Analytics, Search Console, Clarity and social accounts.</p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {clientConnections.map((cc) => <li key={cc.id}><span className="font-medium text-foreground">{cc.name}</span> <span className="text-muted">· {cc.connected} connected</span></li>)}
          </ul>
          <a href="/integrations" className={cn(linkCls, "mt-2")}>Manage client connections</a>
        </div>
      </section>

      {(cat === "all" || cat === "other") && !term && (
        <section aria-label="Custom variables">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Custom variables</h3>
          <CustomVariables orgId={orgId} vars={custom} canEdit={canEdit} />
        </section>
      )}

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} busy={deleting}
        title={confirm ? `Delete ${confirm.f.label}?` : ""} confirmLabel="Delete" tone="danger"
        onConfirm={() => confirm && startDelete(async () => {
          const r = await deleteIntegrationField(orgId, confirm.v.id, confirm.f.key);
          setDeleteMsg(r.ok ? r.message : r.error); setConfirm(null); if (r.ok) router.refresh();
        })}>
        {confirm && <>The saved value is removed from this organization{confirm.v.inUse.length ? <>; {confirm.v.name} is used by {confirm.v.inUse.slice(0, 4).join(", ")}{confirm.v.inUse.length > 4 ? " and more" : ""}, which stop working until a new value is set</> : ""}. This can&apos;t be undone.</>}
      </ConfirmDialog>
    </div>
  );
}
