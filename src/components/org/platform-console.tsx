"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, LayoutGrid, Loader2, Plus, RefreshCw, UserPlus } from "lucide-react";
import { createOrganization, inviteOwner, resendOwnerInvite, saveEnabledPages } from "@/app/(dashboard)/settings/platform/actions";
import { Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { btn, input, label, pill } from "./styles";
import { CopyLink, Status, type ActionResult } from "./ui";

export interface PlatformOrg {
  id: string; name: string; createdAt: string; members: number; owners: number; clients: number; archived: number;
  enabledPages: string[] | null; ownerInvites: { id: string; email: string; expiresAt: string; expired: boolean }[];
}
export interface PageGroupOption { group: string; sections: { label: string; pages: { href: string; label: string }[] }[] }

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Settings → Platform (platform administrators): organizations, their first owners and which pages each may use. */
export function PlatformConsole({ orgs, options }: { orgs: PlatformOrg[]; options: PageGroupOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [pagesFor, setPagesFor] = useState<PlatformOrg | null>(null);
  const [ownerFor, setOwnerFor] = useState<PlatformOrg | null>(null);
  const [link, setLink] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const total = useMemo(() => options.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.pages.length, 0), 0), [options]);

  const run = (key: string, fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setResult(r); setBusy(null); after?.(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Section title="New organization" description="Starts empty: no clients and no credentials. Its first owner gets an invitation and sets everything up.">
        <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const owner = email.trim().toLowerCase();
            run("create", () => createOrganization({ name, ownerEmail: owner }), (r) => {
              if (r.ok) { setName(""); setEmail(""); setLink(r.link ? { link: r.link, emailed: Boolean(r.emailed), email: owner } : null); }
            });
          }}>
          <label className={label}>Organization name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} className={input} placeholder="Acme Marketing" />
          </label>
          <label className={label}>First owner&apos;s email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} className={input} placeholder="owner@acme.com" autoComplete="off" />
          </label>
          <button className={btn.primary} disabled={busy !== null}>{busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" aria-hidden />} Create</button>
        </form>
        <Status result={result} className="mt-3" />
        {link && <div className="mt-3"><CopyLink link={link.link} note={link.emailed
          ? <>Invitation emailed to <strong>{link.email}</strong>. You can also send them this link (works once, for 7 days).</>
          : <>Send this owner invitation to <strong>{link.email}</strong>. It works once, for 7 days, and only for that email address.</>} /></div>}
      </Section>

      <Section title="Organizations" description={`${orgs.length} organization${orgs.length === 1 ? "" : "s"} on the platform.`}>
        <ul className="divide-y divide-hairline rounded-lg border border-border">
          {orgs.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-secondary"><Building2 className="size-4" aria-hidden /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{o.name}
                    <a href={`/settings/organization/integrations?org=${o.id}`} className="ml-2 text-xs font-normal text-secondary underline decoration-border-strong underline-offset-2 hover:text-foreground">Credentials</a>
                  </p>
                  <p className="text-xs text-muted">
                    {o.members} member{o.members === 1 ? "" : "s"} ({o.owners} owner{o.owners === 1 ? "" : "s"}) · {o.clients} client{o.clients === 1 ? "" : "s"}{o.archived ? ` (+${o.archived} archived)` : ""} · since {date(o.createdAt)}
                  </p>
                  {o.ownerInvites.map((i) => (
                    <p key={i.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={cn(pill, i.expired ? "bg-negative-soft text-negative" : "bg-warn-soft text-warn")}>{i.expired ? "Expired" : "Invited"}</span>
                      <span className="text-secondary">Owner: {i.email}</span>
                      <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50" disabled={busy !== null}
                        onClick={() => run(`resend:${i.id}`, () => resendOwnerInvite(o.id, i.id), (r) => { if (r.ok && r.link) setLink({ link: r.link, emailed: Boolean(r.emailed), email: i.email }); })}>
                        {busy === `resend:${i.id}` ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" aria-hidden />} Resend
                      </button>
                    </p>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(pill, o.enabledPages ? "bg-series-soft text-series" : "bg-surface-muted text-secondary")}>
                  {o.enabledPages ? `${o.enabledPages.length} of ${total} pages` : "All pages"}
                </span>
                <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => { setPagesFor(o); setResult(null); }}>
                  <LayoutGrid className="size-4" aria-hidden /> Page access
                </button>
                <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => { setOwnerFor(o); setResult(null); }}>
                  <UserPlus className="size-4" aria-hidden /> Invite owner
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {pagesFor && (
        <PagesDialog key={pagesFor.id} org={pagesFor} options={options} busy={busy === "pages"} onClose={() => setPagesFor(null)}
          onSave={(v) => run("pages", () => saveEnabledPages(pagesFor.id, v), (r) => { if (r.ok) setPagesFor(null); })} />
      )}
      {ownerFor && (
        <OwnerDialog key={ownerFor.id} org={ownerFor} busy={busy === "owner"} onClose={() => setOwnerFor(null)}
          onInvite={(mail) => run("owner", () => inviteOwner(ownerFor.id, mail), (r) => {
            if (r.ok) { setOwnerFor(null); if (r.link) setLink({ link: r.link, emailed: Boolean(r.emailed), email: mail }); }
          })} />
      )}
    </div>
  );
}

function OwnerDialog({ org, busy, onClose, onInvite }: { org: PlatformOrg; busy: boolean; onClose: () => void; onInvite: (email: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <Dialog open onClose={onClose} busy={busy} title={`Invite an owner to ${org.name}`} description="They join as an owner. Inviting the same address again replaces its earlier link.">
      <form onSubmit={(e) => { e.preventDefault(); onInvite(email.trim().toLowerCase()); }}>
        <DialogBody className="text-foreground">
          <label className={label}>Email
            <input type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus className={input} autoComplete="off" />
          </label>
        </DialogBody>
        <DialogFooter>
          <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={dialogBtn.primary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Send invitation</button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function PagesDialog({ org, options, busy, onClose, onSave }: {
  org: PlatformOrg; options: PageGroupOption[]; busy: boolean; onClose: () => void; onSave: (v: { all: boolean; pages: string[] }) => void;
}) {
  const everyHref = useMemo(() => options.flatMap((g) => g.sections.flatMap((s) => s.pages.map((p) => p.href))), [options]);
  const [all, setAll] = useState(org.enabledPages === null);
  const [on, setOn] = useState<Set<string>>(() => new Set(org.enabledPages ?? everyHref));
  const toggle = (hrefs: string[], value: boolean) => setOn((cur) => { const n = new Set(cur); for (const h of hrefs) { if (value) n.add(h); else n.delete(h); } return n; });

  return (
    <Dialog open onClose={onClose} busy={busy} title={`Pages for ${org.name}`}
      description="Choose the dashboard pages this organization can use. Settings and Integrations are always available.">
      <DialogBody className="space-y-4 text-foreground">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" data-autofocus />
          <span><span className="block text-sm font-medium">Every page</span><span className="block text-xs text-muted">Including pages added to SEO Insights later.</span></span>
        </label>
        <fieldset disabled={all || busy} className={cn("space-y-4", all && "opacity-50")}>
          <legend className="sr-only">Pages</legend>
          <div className="flex gap-2">
            <button type="button" className={btn.ghost} onClick={() => setOn(new Set(everyHref))}>Select all</button>
            <button type="button" className={btn.ghost} onClick={() => setOn(new Set())}>Clear</button>
            <span className="ml-auto self-center text-xs text-muted">{on.size} of {everyHref.length} selected</span>
          </div>
          {options.map((g) => (
            <div key={g.group}>
              <p className="text-xs font-medium text-faint">{g.group}</p>
              <ul className="mt-1.5 space-y-1.5">
                {g.sections.map((s) => {
                  const hrefs = s.pages.map((p) => p.href);
                  const count = hrefs.filter((h) => on.has(h)).length;
                  const single = s.pages.length === 1;
                  return (
                    <li key={s.label} className="rounded-lg border border-border">
                      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                        <input type="checkbox" checked={count === hrefs.length} ref={(el) => { if (el) el.indeterminate = count > 0 && count < hrefs.length; }}
                          onChange={(e) => toggle(hrefs, e.target.checked)} className="size-4 accent-[var(--accent)]" />
                        <span className="flex-1 text-sm font-medium">{s.label}</span>
                        {!single && <span className="text-xs text-muted">{count}/{hrefs.length}</span>}
                      </label>
                      {!single && (
                        <ul className="grid gap-x-4 gap-y-1 border-t border-hairline px-3 py-2 sm:grid-cols-2">
                          {s.pages.map((p) => (
                            <li key={p.href}>
                              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-secondary">
                                <input type="checkbox" checked={on.has(p.href)} onChange={(e) => toggle([p.href], e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                                <span className="truncate">{p.label}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <button type="button" className={dialogBtn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={dialogBtn.primary} disabled={busy} onClick={() => onSave({ all, pages: [...on] })}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save
        </button>
      </DialogFooter>
    </Dialog>
  );
}
