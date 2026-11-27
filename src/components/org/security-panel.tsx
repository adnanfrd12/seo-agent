import Link from "next/link";
import { KeyRound, Lock, Mail, ShieldCheck, UserCog } from "lucide-react";
import { Avatar } from "@/components/layout/avatar";
import { Note, Section } from "./section";

interface Person { userId: string; email: string; fullName: string | null; avatarUrl: string | null }

function People({ people, empty }: { people: Person[]; empty: string }) {
  if (!people.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {people.map((p) => (
        <li key={p.userId} className="flex min-w-0 items-center gap-2.5">
          <Avatar src={p.avatarUrl} name={p.fullName} email={p.email} size={28} />
          <span className="min-w-0"><span className="block truncate text-sm">{p.fullName || p.email}</span>{p.fullName && <span className="block truncate text-xs text-muted">{p.email}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** Settings → Organization → Security (read-only): who holds which keys, and how the organization is protected. */
export function SecurityPanel({ owners, admins, deactivated, openInvites, expiredInvites, tabHref }: {
  owners: Person[]; admins: Person[]; deactivated: number; openInvites: number; expiredInvites: number; tabHref: (tab: string) => string;
}) {
  return (
    <div className="space-y-6">
      {owners.length < 2 && (
        <Note tone="warn">This organization has a single owner. Add a second owner under Team members so you can&apos;t be locked out.</Note>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Owners" description="Manage integration credentials and other owners, and everything else.">
          <People people={owners} empty="No active owner." />
        </Section>
        <Section title="Admins" description="Manage settings, branding, members (not owners), clients and client access.">
          <People people={admins} empty="No admins." />
        </Section>
      </div>
      <Section title="How access is protected">
        <ul className="space-y-3 text-sm">
          <li className="flex gap-3"><KeyRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span><strong className="font-medium">Credentials</strong>: only owners add or change them. They&apos;re encrypted, never shown again, never sent to the browser and never used by another organization.</span></li>
          <li className="flex gap-3"><UserCog className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span><strong className="font-medium">Members</strong>: owners and admins invite and manage people; only owners manage owners; nobody changes their own role; the last owner can&apos;t be removed.
              {deactivated > 0 && ` ${deactivated} deactivated member${deactivated === 1 ? "" : "s"} can't open any client.`}</span></li>
          <li className="flex gap-3"><Mail className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span><strong className="font-medium">Invitations</strong>: single-use links for one email address, valid 7 days, stored only as a hash. {openInvites} open{expiredInvites ? `, ${expiredInvites} expired` : ""}.</span></li>
          <li className="flex gap-3"><Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span><strong className="font-medium">Client data</strong>: every page and data request checks the person&apos;s organization and client access on the server.</span></li>
          <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span><strong className="font-medium">Audit</strong>: every settings, member, client and credential change is recorded (who, what, when; never secret values).</span></li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <Link href={tabHref("team")} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-surface-muted">Team members</Link>
          <Link href={tabHref("activity")} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-surface-muted">Activity log</Link>
          <Link href="/integrations" className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-surface-muted">Integrations</Link>
        </div>
      </Section>
    </div>
  );
}
