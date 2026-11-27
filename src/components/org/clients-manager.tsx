"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, Search, Settings2, Users } from "lucide-react";
import { setActiveClient } from "@/app/(dashboard)/client-actions";
import { archiveOrgClient, createOrgClientAction, saveClientAccess, updateOrgClientAction } from "@/app/(dashboard)/settings/organization/actions";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { cn } from "@/lib/utils";
import { DATE_RANGES, PROVIDER_LABEL, ROLE_LABEL, type ClientRoleId, type OrgRoleId } from "./labels";
import { Section } from "./section";
import { btn, input, label, pill } from "./styles";
import { AccessPicker, Status, type ActionResult } from "./ui";

export interface ClientView {
  id: string; name: string; timezone: string; defaultRangeDays: number; createdAt: string; archivedAt: string | null;
  integrations: { provider: string; status: string }[]; access: { userId: string; role: ClientRoleId }[];
}
export interface PersonOption { userId: string; name: string; email: string; role: OrgRoleId; status: "active" | "deactivated" }

const STATUS_TONE: Record<string, string> = { connected: "bg-positive-soft text-positive", error: "bg-negative-soft text-negative" };

/** Settings → Organization → Clients: create, edit, archive / restore, and who can open each client. */
export function ClientsManager({ orgId, canEdit, clients, people, timezones, defaults, myRole, activeClientId }: {
  orgId: string; canEdit: boolean; clients: ClientView[]; people: PersonOption[]; timezones: string[];
  defaults: { timezone: string; rangeDays: number }; myRole: OrgRoleId; activeClientId: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [editing, setEditing] = useState<ClientView | "new" | null>(null);
  const [accessFor, setAccessFor] = useState<ClientView | null>(null);
  const [archiving, setArchiving] = useState<ClientView | null>(null);
  const archivedCount = clients.filter((c) => c.archivedAt).length;
  const assignable = people.filter((p) => p.role === "member" || p.role === "viewer");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return clients.filter((c) => (showArchived || !c.archivedAt) && (!s || c.name.toLowerCase().includes(s)));
  }, [clients, q, showArchived]);

  const run = (key: string, fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setResult(r); setBusy(null); after?.(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <Section title="Clients" description={`${clients.length - archivedCount} active${archivedCount ? `, ${archivedCount} archived` : ""}. Archived clients leave the client switcher; their data is kept.`}
      action={canEdit ? <button type="button" className={btn.primary} onClick={() => { setEditing("new"); setResult(null); }}><Plus className="size-4" aria-hidden /> New client</button> : undefined}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 basis-48">
          <span className="sr-only">Search clients</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className={cn(input, "mt-0 pl-8")} />
        </label>
        {archivedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Show archived ({archivedCount})
          </label>
        )}
      </div>
      <Status result={result} className="mb-3" />
      {shown.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">{clients.length ? "No clients match." : "No clients yet."}</p> : (
        <ul className="divide-y divide-hairline rounded-lg border border-border">
          {shown.map((c) => {
            const explicit = c.access.filter((a) => assignable.some((p) => p.userId === a.userId)).length;
            return (
              <li key={c.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 p-3", c.archivedAt && "bg-surface-sunken")}>
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">{c.name}</span>
                    {c.id === activeClientId && <span className={cn(pill, "bg-accent-soft text-accent")}>Open now</span>}
                    {c.archivedAt && <span className={cn(pill, "bg-warn-soft text-warn")}>Archived</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{c.timezone} · last {c.defaultRangeDays} days by default</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.integrations.length === 0 ? <span className="text-xs text-faint">No integrations connected</span> : c.integrations.map((i) => (
                      <span key={i.provider} title={`${PROVIDER_LABEL[i.provider] ?? i.provider}: ${i.status}`}
                        className={cn(pill, "font-normal", STATUS_TONE[i.status] ?? "bg-surface-muted text-secondary")}>{PROVIDER_LABEL[i.provider] ?? i.provider}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" className={btn.ghost} disabled={!canEdit || busy !== null} onClick={() => { setAccessFor(c); setResult(null); }}
                    title="Organization owners and admins reach every client. Choose which team members and viewers can open this one.">
                    <Users className="size-4" aria-hidden /> {explicit} {explicit === 1 ? "person" : "people"}
                  </button>
                  {canEdit && (
                    <button type="button" className={btn.icon} disabled={busy !== null} aria-label={`Edit ${c.name}`} title="Edit" onClick={() => { setEditing(c); setResult(null); }}>
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  )}
                  {!c.archivedAt && (
                    <button type="button" className={btn.icon} disabled={busy !== null} aria-label={`Open ${c.name}'s settings`} title="Client settings"
                      onClick={() => run(`open:${c.id}`, async () => {
                        const r = await setActiveClient(c.id);
                        if (r.ok) router.push("/settings");
                        return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Couldn't open that client." };
                      })}>
                      {busy === `open:${c.id}` ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" aria-hidden />}
                    </button>
                  )}
                  {canEdit && (c.archivedAt ? (
                    <button type="button" className={btn.icon} disabled={busy !== null} aria-label={`Restore ${c.name}`} title="Restore"
                      onClick={() => run(`archive:${c.id}`, () => archiveOrgClient(orgId, c.id, false))}>
                      {busy === `archive:${c.id}` ? <Loader2 className="size-4 animate-spin" /> : <ArchiveRestore className="size-4" aria-hidden />}
                    </button>
                  ) : (
                    <button type="button" className={btn.icon} disabled={busy !== null} aria-label={`Archive ${c.name}`} title="Archive" onClick={() => setArchiving(c)}>
                      <Archive className="size-4" aria-hidden />
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ClientDialog key={editing === "new" ? "new" : editing.id} client={editing === "new" ? null : editing} timezones={timezones} defaults={defaults}
          busy={busy === "save"} onClose={() => setEditing(null)}
          onSave={(v) => run("save", () => (editing === "new" ? createOrgClientAction(orgId, v) : updateOrgClientAction(orgId, editing.id, v)), (r) => { if (r.ok) setEditing(null); })} />
      )}

      {accessFor && (
        <ClientAccessDialog key={accessFor.id} client={accessFor} people={assignable} myRole={myRole} busy={busy === "access"} onClose={() => setAccessFor(null)}
          onSave={(a) => run("access", () => saveClientAccess(orgId, accessFor.id, a), (r) => { if (r.ok) setAccessFor(null); })} />
      )}

      <ConfirmDialog open={archiving !== null} onClose={() => setArchiving(null)} title={`Archive ${archiving?.name ?? "this client"}?`} confirmLabel="Archive" tone="primary"
        icon={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-warn-soft text-warn"><Archive className="size-5" aria-hidden /></span>}
        onConfirm={() => { const c = archiving!; setArchiving(null); run(`archive:${c.id}`, () => archiveOrgClient(orgId, c.id, true)); }}>
        It disappears from the client switcher and the dashboard. Its data, connections and reports are kept, and you can restore it here at any time.
      </ConfirmDialog>
    </Section>
  );
}

function ClientDialog({ client, timezones, defaults, busy, onClose, onSave }: {
  client: ClientView | null; timezones: string[]; defaults: { timezone: string; rangeDays: number }; busy: boolean;
  onClose: () => void; onSave: (v: { name: string; timezone: string; defaultRangeDays: number }) => void;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [timezone, setTimezone] = useState(client?.timezone ?? defaults.timezone);
  const [range, setRange] = useState(client?.defaultRangeDays ?? defaults.rangeDays);
  const zones = timezones.includes(timezone) ? timezones : [timezone, ...timezones];
  return (
    <Dialog open onClose={onClose} busy={busy} title={client ? `Edit ${client.name}` : "New client"}
      description={client ? undefined : "You'll be able to connect its integrations once it's created."}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ name, timezone, defaultRangeDays: range }); }}>
        <DialogBody className="space-y-4 text-foreground">
          <label className={label}>Client name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} data-autofocus className={input} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Time zone
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input}>
                {zones.map((tz) => <option key={tz}>{tz}</option>)}
              </select>
            </label>
            <label className={label}>Default date range
              <select value={range} onChange={(e) => setRange(Number(e.target.value))} className={input}>
                {DATE_RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </select>
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={dialogBtn.primary} disabled={busy || !name.trim()}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {client ? "Save" : "Create client"}</button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ClientAccessDialog({ client, people, myRole, busy, onClose, onSave }: {
  client: ClientView; people: PersonOption[]; myRole: OrgRoleId; busy: boolean; onClose: () => void; onSave: (a: { userId: string; role: ClientRoleId }[]) => void;
}) {
  const [value, setValue] = useState<Record<string, ClientRoleId>>(() =>
    Object.fromEntries(client.access.filter((a) => people.some((p) => p.userId === a.userId)).map((a) => [a.userId, a.role])));
  const rows = people.map((p) => ({
    id: p.userId, label: p.name, sub: `${p.email} · ${ROLE_LABEL[p.role]}${p.status === "deactivated" ? " · deactivated" : ""}`,
    roles: p.role === "viewer" ? ["viewer" as const] : myRole === "owner" ? ["admin" as const, "viewer" as const, "owner" as const] : ["admin" as const, "viewer" as const],
    locked: value[p.userId] === "owner" && myRole !== "owner" ? "Client owner: only an organization owner can change this" : undefined,
  }));
  return (
    <Dialog open onClose={onClose} busy={busy} title={`Who can open ${client.name}`}
      description="Organization owners and admins always can. Pick the team members and viewers who should.">
      <DialogBody className="text-foreground">
        {people.length === 0 ? <p className="text-sm text-muted">There are no team members or viewers yet. Invite them under Team members.</p> : (
          <AccessPicker rows={rows} value={value} onChange={setValue} roles={["admin", "viewer"]} defaultRole="viewer" noun="people" disabled={busy} />
        )}
      </DialogBody>
      <DialogFooter>
        <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={dialogBtn.primary} disabled={busy || people.length === 0}
          onClick={() => onSave(Object.entries(value).map(([userId, role]) => ({ userId, role })))}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save access
        </button>
      </DialogFooter>
    </Dialog>
  );
}
