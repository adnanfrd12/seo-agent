"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Mail, RefreshCw, Trash2, UserCheck, UserPlus, UserX, X } from "lucide-react";
import { changeRole, inviteMember, removeFromOrg, resendInvite, revokeInvite, saveMemberAccess, setStatus } from "@/app/(dashboard)/settings/organization/actions";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { Avatar } from "@/components/layout/avatar";
import { cn } from "@/lib/utils";
import { CLIENT_ROLE_LABEL, ROLE_HINT, ROLE_LABEL, type ClientRoleId, type OrgRoleId } from "./labels";
import { RoleBadge, Section } from "./section";
import { btn, hint, input, label, pill } from "./styles";
import { AccessPicker, CopyLink, Status, type ActionResult } from "./ui";

export interface MemberView {
  userId: string; email: string; fullName: string | null; avatarUrl: string | null; role: OrgRoleId; status: "active" | "deactivated";
  joinedAt: string; lastSignInAt: string | null; clients: { id: string; role: ClientRoleId }[];
}
export interface InviteView { id: string; email: string; role: OrgRoleId; clients: number; invitedBy: string | null; expiresAt: string; expired: boolean }
export interface ClientOption { id: string; name: string; archived: boolean }

const ago = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : `${Math.floor(d / 30)} months ago`;
};
const until = (iso: string) => {
  const h = Math.ceil((Date.parse(iso) - Date.now()) / 3_600_000);
  return h <= 0 ? "Expired" : h < 48 ? `Expires in ${h} h` : `Expires in ${Math.floor(h / 24)} days`;
};
const allClients = (r: OrgRoleId) => r === "owner" || r === "admin";
const clientRolesFor = (memberRole: OrgRoleId, myRole: OrgRoleId): ClientRoleId[] =>
  memberRole === "viewer" ? ["viewer"] : myRole === "owner" ? ["admin", "viewer", "owner"] : ["admin", "viewer"];

/** Settings → Organization → Team members: members, their roles, status and client access, and invitations. */
export function TeamManager({ orgId, me, members, invitations, clients, emailEnabled }: {
  orgId: string; me: { userId: string; role: OrgRoleId }; members: MemberView[]; invitations: InviteView[]; clients: ClientOption[]; emailEnabled: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [accessFor, setAccessFor] = useState<MemberView | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "remove" | "deactivate" | "revoke"; id: string; name: string } | null>(null);
  const [link, setLink] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const roles: OrgRoleId[] = me.role === "owner" ? ["owner", "admin", "member", "viewer"] : ["admin", "member", "viewer"];
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const active = members.filter((m) => m.status === "active").length;

  const run = (key: string, fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setResult(r); setBusy(null);
      after?.(r);
      if (r.ok) router.refresh();
    });
  };
  const manageable = (m: MemberView) => m.userId !== me.userId && (me.role === "owner" || m.role !== "owner");

  return (
    <div className="space-y-6">
      <Section title="Members" description={`${active} active${members.length > active ? `, ${members.length - active} deactivated` : ""}.`}
        action={<button type="button" className={btn.primary} onClick={() => { setInviting(true); setResult(null); }}><UserPlus className="size-4" aria-hidden /> Invite</button>}>
        <ul className="divide-y divide-hairline rounded-lg border border-border">
          {members.map((m) => {
            const isMe = m.userId === me.userId;
            const can = manageable(m);
            const seen = ago(m.lastSignInAt);
            return (
              <li key={m.userId} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 p-3", m.status === "deactivated" && "bg-surface-sunken")}>
                <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                  <Avatar src={m.avatarUrl} name={m.fullName} email={m.email} size={36} className={m.status === "deactivated" ? "opacity-50" : undefined} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.fullName || m.email}{isMe && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</p>
                    <p className="truncate text-xs text-muted">{m.email}{seen ? ` · signed in ${seen}` : " · never signed in"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.status === "deactivated" && <span className={cn(pill, "bg-warn-soft text-warn")}>Deactivated</span>}
                  {allClients(m.role) ? (
                    <span className="text-xs text-muted">All clients</span>
                  ) : (
                    <button type="button" disabled={!can} onClick={() => { setAccessFor(m); setResult(null); }}
                      className={cn("rounded-md px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent", can && "underline decoration-dotted underline-offset-2 hover:text-foreground",
                        m.clients.length ? "text-secondary" : "text-warn")}
                      title={m.clients.map((c) => `${clientName.get(c.id) ?? "Client"} (${CLIENT_ROLE_LABEL[c.role]})`).join("\n") || undefined}>
                      {m.clients.length ? `${m.clients.length} client${m.clients.length === 1 ? "" : "s"}` : "No clients yet"}
                    </button>
                  )}
                  {can ? (
                    <select aria-label={`Role for ${m.email}`} value={m.role} disabled={busy !== null}
                      onChange={(e) => run(`role:${m.userId}`, () => changeRole(orgId, m.userId, e.target.value))}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
                      {Array.from(new Set([m.role, ...roles])).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <RoleBadge role={m.role} />}
                  {can && (
                    <>
                      {m.status === "active" ? (
                        <button type="button" className={btn.icon} disabled={busy !== null} aria-label={`Deactivate ${m.email}`} title="Deactivate"
                          onClick={() => setConfirm({ kind: "deactivate", id: m.userId, name: m.fullName || m.email })}>
                          <UserX className="size-4" aria-hidden />
                        </button>
                      ) : (
                        <button type="button" className={btn.icon} disabled={busy !== null} aria-label={`Reactivate ${m.email}`} title="Reactivate"
                          onClick={() => run(`status:${m.userId}`, () => setStatus(orgId, m.userId, "active"))}>
                          {busy === `status:${m.userId}` ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" aria-hidden />}
                        </button>
                      )}
                      <button type="button" className={cn(btn.icon, "hover:text-negative")} disabled={busy !== null} aria-label={`Remove ${m.email}`} title="Remove from organization"
                        onClick={() => setConfirm({ kind: "remove", id: m.userId, name: m.fullName || m.email })}>
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <Status result={result} className="mt-3" />
        {link && !inviting && <div className="mt-3"><CopyLink link={link.link} note={linkNote(link)} /></div>}
      </Section>

      <Section title="Pending invitations" description="Links expire after 7 days and work once. Resending makes a new link; the old one stops working.">
        {invitations.length === 0 ? <p className="text-sm text-muted">No open invitations.</p> : (
          <ul className="divide-y divide-hairline rounded-lg border border-border">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-muted"><Mail className="size-4" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="truncate text-xs text-muted">
                      {i.invitedBy ? `Invited by ${i.invitedBy} · ` : ""}{allClients(i.role) ? "all clients" : `${i.clients} client${i.clients === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-xs", i.expired ? "text-negative" : "text-muted")}>{until(i.expiresAt)}</span>
                  <RoleBadge role={i.role} />
                  {(me.role === "owner" || i.role !== "owner") && (
                    <>
                      <button type="button" className={btn.secondary} disabled={busy !== null}
                        onClick={() => run(`resend:${i.id}`, () => resendInvite(orgId, i.id), (r) => { if (r.ok && r.link) setLink({ email: i.email, link: r.link, emailed: Boolean(r.emailed) }); })}>
                        {busy === `resend:${i.id}` ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" aria-hidden />} Resend
                      </button>
                      <button type="button" className={cn(btn.icon, "hover:text-negative")} disabled={busy !== null} aria-label={`Withdraw the invitation for ${i.email}`} title="Withdraw"
                        onClick={() => setConfirm({ kind: "revoke", id: i.id, name: i.email })}>
                        <X className="size-4" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!emailEnabled && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Platform email isn&apos;t set up, so copy each invitation link and send it yourself. The link alone can&apos;t sign anyone in: people confirm their own address with a sign-in link emailed to it.
          </p>
        )}
      </Section>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} orgId={orgId} roles={roles} myRole={me.role} clients={clients}
        onInvited={(l) => { setLink(l); router.refresh(); }} />

      {accessFor && (
        <AccessDialog key={accessFor.userId} member={accessFor} myRole={me.role} clients={clients} onClose={() => setAccessFor(null)}
          onSave={(access) => run(`access:${accessFor.userId}`, () => saveMemberAccess(orgId, accessFor.userId, access), (r) => { if (r.ok) setAccessFor(null); })}
          busy={busy === `access:${accessFor.userId}`} />
      )}

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} busy={busy !== null}
        title={confirm?.kind === "remove" ? `Remove ${confirm.name}?` : confirm?.kind === "deactivate" ? `Deactivate ${confirm?.name}?` : `Withdraw the invitation for ${confirm?.name}?`}
        confirmLabel={confirm?.kind === "remove" ? "Remove" : confirm?.kind === "deactivate" ? "Deactivate" : "Withdraw"}
        onConfirm={() => {
          const c = confirm!;
          setConfirm(null);
          if (c.kind === "remove") run(`remove:${c.id}`, () => removeFromOrg(orgId, c.id));
          else if (c.kind === "deactivate") run(`status:${c.id}`, () => setStatus(orgId, c.id, "deactivated"));
          else run(`revoke:${c.id}`, () => revokeInvite(orgId, c.id));
        }}>
        {confirm?.kind === "remove" ? "They lose access to this organization and its clients. Their account and any other organizations stay. Invite them again to bring them back."
          : confirm?.kind === "deactivate" ? "They keep their role and client access but can't open this organization's clients until you reactivate them."
            : "The link stops working. You can invite them again later."}
      </ConfirmDialog>
    </div>
  );
}

const linkNote = (l: { email: string; emailed: boolean }) => l.emailed
  ? <>We emailed the invitation to <strong>{l.email}</strong>. You can also send them this link. It works once, for 7 days.</>
  : <>Send this link to <strong>{l.email}</strong>. It works once, for 7 days, and only for that email address.</>;

function InviteDialog({ open, onClose, orgId, roles, myRole, clients, onInvited }: {
  open: boolean; onClose: () => void; orgId: string; roles: OrgRoleId[]; myRole: OrgRoleId; clients: ClientOption[];
  onInvited: (l: { email: string; link: string; emailed: boolean }) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRoleId>("member");
  const [access, setAccess] = useState<Record<string, ClientRoleId>>({});
  const [result, setResult] = useState<ActionResult | null>(null);
  const [done, setDone] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [pending, start] = useTransition();
  const rows = clients.filter((c) => !c.archived).map((c) => ({ id: c.id, label: c.name }));
  const clientRoles = clientRolesFor(role, myRole);
  const reset = () => { setEmail(""); setRole("member"); setAccess({}); setResult(null); setDone(null); };
  const close = () => { if (!pending) { reset(); onClose(); } };

  return (
    <Dialog open={open} onClose={close} busy={pending} title="Invite someone" description="They join this organization with the role you choose.">
      {done ? (
        <>
          <DialogBody><CopyLink link={done.link} note={linkNote(done)} /></DialogBody>
          <DialogFooter>
            <button type="button" className={dialogBtn.secondary} onClick={() => { reset(); }}>Invite another</button>
            <button type="button" className={dialogBtn.primary} data-autofocus onClick={close}>Done</button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          const clientAccess = allClients(role) ? [] : Object.entries(access).map(([clientId, r]) => ({ clientId, role: role === "viewer" ? "viewer" as const : r }));
          start(async () => {
            const r = await inviteMember(orgId, { email, role, clientAccess });
            setResult(r);
            if (r.ok && r.link) { const l = { email: email.trim().toLowerCase(), link: r.link, emailed: Boolean(r.emailed) }; setDone(l); onInvited(l); }
          });
        }}>
          <DialogBody className="space-y-4 text-foreground">
            <label className={label}>Email
              <input type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus className={input} autoComplete="off" placeholder="name@company.com" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium">Role</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <label key={r} className={cn("flex cursor-pointer gap-2.5 rounded-lg border p-2.5", role === r ? "border-accent bg-accent-soft/40" : "border-border hover:bg-surface-muted")}>
                    <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-0.5 accent-[var(--accent)]" />
                    <span><span className="block text-sm font-medium">{ROLE_LABEL[r]}</span><span className="block text-xs text-muted">{ROLE_HINT[r]}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {allClients(role) ? (
              <p className="text-sm text-muted">{ROLE_LABEL[role]}s reach every client of the organization.</p>
            ) : (
              <div>
                <p className="text-sm font-medium">Client access</p>
                <span className={hint}>{role === "viewer" ? "Viewers can only view." : "Choose what they can do in each client."} You can change this later.</span>
                <div className="mt-2">
                  <AccessPicker rows={rows} value={access} onChange={setAccess} roles={clientRoles} defaultRole={role === "viewer" ? "viewer" : "admin"} noun="clients" disabled={pending} />
                </div>
              </div>
            )}
            <Status result={result && !result.ok ? result : null} />
          </DialogBody>
          <DialogFooter>
            <button type="button" className={dialogBtn.secondary} onClick={close} disabled={pending}>Cancel</button>
            <button className={dialogBtn.primary} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Send invitation</button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

function AccessDialog({ member, myRole, clients, onClose, onSave, busy }: {
  member: MemberView; myRole: OrgRoleId; clients: ClientOption[]; onClose: () => void; onSave: (a: { clientId: string; role: ClientRoleId }[]) => void; busy: boolean;
}) {
  const [value, setValue] = useState<Record<string, ClientRoleId>>(() => Object.fromEntries(member.clients.map((c) => [c.id, c.role])));
  // archived clients the member can still reach stay listed so their access isn't dropped by accident
  const rows = clients.filter((c) => !c.archived || value[c.id]).map((c) => ({
    id: c.id, label: c.name, sub: c.archived ? "Archived" : undefined,
    locked: value[c.id] === "owner" && myRole !== "owner" ? "Client owner: only an organization owner can change this" : undefined,
  }));
  return (
    <Dialog open onClose={onClose} busy={busy} title={`Client access: ${member.fullName || member.email}`}
      description={`${ROLE_LABEL[member.role]}. ${member.role === "viewer" ? "Viewers can only view." : "Choose what they can do in each client."}`}>
      <DialogBody className="text-foreground">
        <AccessPicker rows={rows} value={value} onChange={setValue} roles={clientRolesFor(member.role, myRole)} defaultRole={member.role === "viewer" ? "viewer" : "admin"} noun="clients" disabled={busy} />
      </DialogBody>
      <DialogFooter>
        <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={dialogBtn.primary} disabled={busy} onClick={() => onSave(Object.entries(value).map(([clientId, role]) => ({ clientId, role })))}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save access
        </button>
      </DialogFooter>
    </Dialog>
  );
}
