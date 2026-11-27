"use client";

import { useId, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, CircleAlert, ExternalLink, FileDown, Loader2, PlugZap, Server, Trash2, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/dashboard/dialog";
import { deleteIntegrationCredentials, testIntegrationConnection } from "@/app/(dashboard)/integrations/credential-actions";
import type { GuideContext } from "@/lib/org/guides";
import type { TestStatus } from "@/lib/org/tests";
import { cn } from "@/lib/utils";
import { CopyField } from "./copy-field";
import { CredentialDialog } from "./credential-dialog";
import { IntegrationLogo } from "./integration-logo";
import type { CredentialStatus, IntegrationView } from "./types";

/** the setup guides are long: loaded the first time someone opens one */
export const GuidePanel = dynamic(() => import("./guide-panel"), {
  loading: () => <p className="flex items-center gap-1.5 text-muted"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading the setup guide…</p>,
});

/** "Setup instructions": a toggle and the region it opens (the guide is loaded on first open). */
export function useGuideToggle() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return { open, loaded, toggle: () => { setOpen((v) => !v); setLoaded(true); } };
}

export const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-medium text-foreground outline-none transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50";
const iconBtn = "grid size-8 place-items-center rounded-lg text-muted outline-none transition hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

const BADGE: Record<CredentialStatus, string> = {
  configured: "bg-positive-soft text-positive",
  connected: "bg-positive-soft text-positive",
  partial: "bg-warn-soft text-warn",
  missing: "bg-surface-muted text-secondary",
  not_connected: "bg-surface-muted text-secondary",
};
const DOT: Record<CredentialStatus, string> = {
  configured: "bg-positive", connected: "bg-positive", partial: "bg-warn", missing: "bg-border-strong", not_connected: "bg-border-strong",
};

export function StatusBadge({ status, label }: { status: CredentialStatus; label: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", BADGE[status])}>
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />{label}
    </span>
  );
}

const TEST_TONE: Record<TestStatus, { cls: string; icon: typeof CheckCircle2 }> = {
  ok: { cls: "bg-positive-soft text-positive", icon: CheckCircle2 },
  warning: { cls: "bg-warn-soft text-warn", icon: TriangleAlert },
  error: { cls: "bg-negative-soft text-negative", icon: CircleAlert },
};

function Features({ list }: { list: string[] }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 4);
  return (
    <div>
      <p className="text-xs font-medium text-muted">Used for</p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {shown.map((f) => <li key={f} className="rounded-md border border-hairline bg-surface-sunken px-1.5 py-0.5 text-xs text-secondary">{f}</li>)}
        {list.length > 4 && (
          <li>
            <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="rounded-md px-1.5 py-0.5 text-xs font-medium text-secondary underline decoration-border-strong underline-offset-2 hover:text-foreground">
              {all ? "Show less" : `+${list.length - 4} more`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

const listOf = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * One integration of the registry: status, saved values (masked, owners only), what depends on it, and the
 * actions: Add / Edit, Test connection, setup instructions, PDF guide and Delete. Per-client integrations
 * (Google Analytics, Search Console, Clarity) show how many clients are connected and link to that section.
 */
export function CredentialCard({ view, orgId, orgName, canEdit, canTest, guideContext, pdfHref }: {
  view: IntegrationView;
  orgId: string;
  orgName: string;
  /** owners: configure, edit and delete */
  canEdit: boolean;
  /** owners and admins */
  canTest: boolean;
  /** fills the setup guide's addresses and names (this deployment, white-label name, organization) */
  guideContext: GuideContext;
  /** the PDF guide (owners and admins) */
  pdfHref?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [editor, setEditor] = useState({ open: false, n: 0 });
  const guide = useGuideToggle();
  const [confirm, setConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<{ status: TestStatus; message: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [deleting, startDelete] = useTransition();
  const busy = testing || deleting;
  const configurable = view.fields.length > 0 && !view.perClient;
  const hasValues = view.fields.some((f) => f.set);

  const runTest = () => startTest(async () => {
    setTest(null);
    try { setTest(await testIntegrationConnection(orgId, view.id)); }
    catch { setTest({ status: "error", message: "Couldn't run the test. Check your connection and try again." }); }
  });

  const onSaved = (message: string) => {
    setEditor((e) => ({ ...e, open: false }));
    setNotice({ ok: true, text: message });
    router.refresh();
    if (view.testable) runTest();
  };

  const remove = () => startDelete(async () => {
    setDeleteError(null);
    try {
      const r = await deleteIntegrationCredentials(orgId, view.id);
      if (!r.ok) { setDeleteError(r.error); return; }
      setConfirm(false);
      setTest(null);
      setNotice({ ok: true, text: r.message });
      router.refresh();
    } catch {
      setDeleteError("Couldn't delete. Check your connection and try again.");
    }
  });

  const TestIcon = test ? TEST_TONE[test.status].icon : null;
  const features = view.features.slice(0, 3);
  return (
    <article className="flex h-full min-w-0 flex-col rounded-[10px] border border-border bg-surface" aria-labelledby={`${uid}-title`}>
      <header className="flex items-start gap-3 px-4 pt-4">
        <IntegrationLogo id={view.id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 id={`${uid}-title`} className="text-[15px] font-semibold leading-snug">{view.name}</h3>
            <StatusBadge status={view.status} label={view.statusLabel} />
          </div>
          <p className="mt-0.5 text-xs text-muted">{view.categoryLabel}</p>
        </div>
      </header>

      <div className="flex-1 space-y-3 px-4 pb-4 pt-3 text-sm">
        <p className="leading-relaxed text-secondary">{view.description}</p>

        {configurable && (
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-hairline bg-surface-sunken px-3 py-2 text-[13px]">
            {view.fields.map((f) => (
              <div key={f.key} className="contents">
                <dt className="truncate text-muted" title={f.key}>{f.label}</dt>
                <dd className="min-w-0 truncate text-right">
                  {!f.set ? <span className={f.required ? "text-warn" : "text-faint"}>{f.required ? "Missing" : "Not set"}</span>
                    : f.display ? <span className="font-mono text-[12px] text-foreground" title={f.secret ? "Saved; only the last characters are shown" : undefined}>{f.display}</span>
                    : <span className="text-foreground">Set</span>}
                  {f.source === "env" && <span className="ml-1.5 text-[11px] text-muted" title="Read from the hosting environment until it's imported">(server)</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {view.fromEnv && (
          <p className="flex items-start gap-1.5 text-xs text-secondary">
            <Server className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            {view.stored ? "Some values still come" : "Values still come"} from the server environment. {canEdit ? "Import them at the top of this section, or save new ones here." : "An owner can import them."}
          </p>
        )}
        {view.status === "partial" && view.missing.length > 0 && (
          <p className="text-xs text-warn">Still needed: {listOf(view.missing)}.</p>
        )}
        {view.redirectUri && <CopyField label="OAuth redirect URI" value={view.redirectUri} />}
        {view.perClient && <p className="text-xs leading-relaxed text-secondary">{view.perClient}</p>}

        <Features list={view.features} />

        {view.updated && <p className="text-xs text-muted">Updated {view.updated}</p>}

        {notice && (
          <p role={notice.ok ? "status" : "alert"} className={cn("text-[13px]", notice.ok ? "text-positive" : "text-negative")}>{notice.text}</p>
        )}
        {testing && <p role="status" className="flex items-center gap-1.5 text-[13px] text-muted"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Testing the connection…</p>}
        {test && TestIcon && (
          <p role={test.status === "error" ? "alert" : "status"} className={cn("flex items-start gap-1.5 rounded-lg px-3 py-2 text-[13px] leading-relaxed", TEST_TONE[test.status].cls)}>
            <TestIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{test.message}</span>
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        {configurable && canEdit && (
          <button type="button" className={view.status === "configured" ? btn : btnPrimary} disabled={busy}
            onClick={() => { setNotice(null); setEditor((e) => ({ open: true, n: e.n + 1 })); }}>
            {view.status === "configured" || hasValues ? "Edit" : "Add"}
          </button>
        )}
        {view.perClient && (
          <a href="#client-connections" className={btn}>Connect a client <ArrowRight className="size-3.5" aria-hidden /></a>
        )}
        {view.testable && canTest && (
          <button type="button" className={btn} onClick={runTest} disabled={busy || !hasValues} title={!hasValues ? "Add the credentials first" : undefined}>
            {testing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PlugZap className="size-3.5" aria-hidden />} Test connection
          </button>
        )}
        <button type="button" className={btn} onClick={guide.toggle} aria-expanded={guide.open} aria-controls={`${uid}-guide`}>
          <BookOpen className="size-3.5" aria-hidden /> Setup instructions
          <ChevronDown className={cn("size-3.5 text-muted transition-transform", guide.open && "rotate-180")} aria-hidden />
        </button>
        <span className="ml-auto flex items-center gap-1">
          {pdfHref && (
            <a href={pdfHref} download className={iconBtn} aria-label={`Download the ${view.name} setup guide (PDF)`} title="Download the PDF guide">
              <FileDown className="size-4" aria-hidden />
            </a>
          )}
          {canEdit && configurable && view.stored > 0 && (
            <button type="button" className={cn(iconBtn, "hover:bg-negative-soft hover:text-negative")} disabled={busy}
              onClick={() => { setDeleteError(null); setConfirm(true); }} aria-label={`Delete the ${view.name} credentials`} title="Delete credentials">
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </span>
      </footer>

      <div id={`${uid}-guide`} role="region" aria-label={`${view.name} setup instructions`} hidden={!guide.open}
        className="max-h-[32rem] overflow-y-auto border-t border-hairline bg-surface-sunken px-4 py-3 text-[13px] leading-relaxed text-secondary">
        {guide.loaded && (
          <GuidePanel id={view.id} context={guideContext} fallback={(
            <div className="space-y-2">
              <p>{view.perClient ?? `Get the credentials from ${view.name}, then use ${canEdit ? "Add" : "Add (owners)"} on this card.`}</p>
              <p className="flex flex-wrap gap-x-4 gap-y-1">
                {view.consoleUrl && <a href={view.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Open the console <ExternalLink className="size-3" aria-hidden /></a>}
                {view.docsUrl && <a href={view.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Documentation <ExternalLink className="size-3" aria-hidden /></a>}
              </p>
            </div>
          )} />
        )}
      </div>

      {configurable && canEdit && (
        <CredentialDialog key={editor.n} open={editor.open} view={view} orgId={orgId} orgName={orgName}
          onClose={() => setEditor((e) => ({ ...e, open: false }))} onSaved={onSaved} />
      )}
      {canEdit && configurable && (
        <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={remove} busy={deleting} error={deleteError}
          title={`Delete the ${view.name} credentials?`} confirmLabel="Delete credentials"
          icon={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-negative-soft text-negative"><Trash2 className="size-5" aria-hidden /></span>}>
          <p>
            The {view.stored === 1 ? "saved value is" : `${view.stored} saved values are`} deleted from {orgName}.{" "}
            {view.envBackup
              ? "This organization still falls back to the server environment, so its values are used again until they're imported or removed there."
              : features.length > 0 && <>{listOf(view.features.length > 3 ? [...features, `${view.features.length - 3} more`] : features)} stop working for every client until new credentials are saved.</>}
          </p>
          {view.inUse.length > 0 && (
            <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px]">
              <p className="font-medium text-warn">In use right now</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-secondary">{view.inUse.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          <p className="mt-3">This can&apos;t be undone.</p>
        </ConfirmDialog>
      )}
    </article>
  );
}
