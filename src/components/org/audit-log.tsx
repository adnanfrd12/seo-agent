import "server-only";
import Link from "next/link";
import { Avatar } from "@/components/layout/avatar";
import { userDirectory } from "@/lib/org/members";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, type OrgRoleId } from "./labels";
import { Section } from "./section";
import { btn, input } from "./styles";

/**
 * Settings → Organization → Activity and audit log: who changed what, when. Filters by person, kind of change and
 * dates (in the organization's time zone). Only the change itself is shown, never stored or secret values.
 * The caller has checked can.viewAudit.
 */
const PAGE = 50;
export const AUDIT_KINDS: { id: string; label: string; prefixes: string[] }[] = [
  { id: "organization", label: "Organization", prefixes: ["organization."] },
  { id: "branding", label: "Branding", prefixes: ["branding."] },
  { id: "members", label: "Members and invitations", prefixes: ["member.", "invitation."] },
  { id: "clients", label: "Clients", prefixes: ["client."] },
  { id: "credentials", label: "Credentials", prefixes: ["credential."] },
];
const LABEL: Record<string, string> = {
  "organization.create": "Created the organization",
  "organization.update": "Changed organization details",
  "organization.preferences": "Changed preferences",
  "organization.pages": "Changed which pages the organization can use",
  "member.invite": "Invited someone",
  "invitation.resend": "Resent an invitation",
  "invitation.revoke": "Withdrew an invitation",
  "invitation.accept": "Joined through an invitation",
  "member.role": "Changed a role",
  "member.deactivate": "Deactivated a member",
  "member.activate": "Reactivated a member",
  "member.remove": "Removed a member",
  "member.client_access": "Changed a member's client access",
  "client.create": "Created a client",
  "client.update": "Edited a client",
  "client.archive": "Archived a client",
  "client.restore": "Restored a client",
  "client.access": "Changed who can open a client",
  "client.delete": "Deleted a client workspace",
  "credential.create": "Added a credential",
  "credential.update": "Changed a credential",
  "credential.delete": "Removed a credential",
  "credential.import_env": "Imported the server's credentials",
};
const humanize = (action: string) => LABEL[action] ?? (action.startsWith("branding.") ? "Changed branding" : action.replace(/[._]/g, " "));
const roleName = (r: unknown) => (typeof r === "string" && r in ROLE_LABEL ? ROLE_LABEL[r as OrgRoleId] : null);
const list = (v: unknown, n = 6) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n).join(", ") + (v.length > n ? ` and ${v.length - n} more` : "") : "");

/** Only known, value-free details are shown: field names, roles, counts and integration or page names. */
function describe(d: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(d.fields) && d.fields.length) out.push(`Fields: ${list(d.fields, 10)}`);
  if (roleName(d.from) && roleName(d.to)) out.push(`${roleName(d.from)} → ${roleName(d.to)}`);
  else if (roleName(d.role)) out.push(`Role: ${roleName(d.role)}`);
  if (typeof d.integration === "string") out.push(`Integration: ${d.integration}`);
  if (typeof d.clients === "number") out.push(`${d.clients} client${d.clients === 1 ? "" : "s"}`);
  const delta = [typeof d.added === "number" && d.added ? `${d.added} added` : "", typeof d.changed === "number" && d.changed ? `${d.changed} changed` : "", typeof d.removed === "number" && d.removed ? `${d.removed} removed` : ""].filter(Boolean);
  if (delta.length) out.push(delta.join(", "));
  if (typeof d.emailed === "boolean") out.push(d.emailed ? "Emailed" : "Link shared by hand");
  if (d.all === true) out.push("Every page");
  else if (typeof d.enabled === "number") out.push(`${d.enabled} pages enabled`);
  if (Array.isArray(d.turned_on) && d.turned_on.length) out.push(`On: ${list(d.turned_on)}`);
  if (Array.isArray(d.turned_off) && d.turned_off.length) out.push(`Off: ${list(d.turned_off)}`);
  if (Array.isArray(d.imported)) out.push(`${d.imported.length} imported`);
  if (d.by === "platform") out.push("By a platform administrator");
  return out;
}

/** Midnight of a calendar day in a time zone, as an instant. */
function startOfDay(ymd: string, timeZone: string): Date {
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(guess - (Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - guess));
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function AuditLog({ orgId, timeZone, people, params, basePath, orgParam }: {
  orgId: string; timeZone: string; people: { userId: string; label: string }[];
  params: { who?: string; kind?: string; from?: string; to?: string; page?: string }; basePath: string; orgParam: string | null;
}) {
  const admin = createAdminClient();
  const who = params.who && UUID.test(params.who) ? params.who : "";
  const kind = AUDIT_KINDS.find((k) => k.id === params.kind) ?? null;
  const from = params.from && YMD.test(params.from) ? params.from : "";
  const to = params.to && YMD.test(params.to) ? params.to : "";
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  let q = admin.from("organization_audit_log").select("id, actor_user_id, action, target, detail, created_at", { count: "exact" }).eq("organization_id", orgId);
  if (who) q = q.eq("actor_user_id", who);
  if (kind) q = q.or(kind.prefixes.map((p) => `action.like.${p}*`).join(","));
  if (from) q = q.gte("created_at", startOfDay(from, timeZone).toISOString());
  if (to) q = q.lt("created_at", new Date(startOfDay(to, timeZone).getTime() + 86_400_000).toISOString());
  const { data, count, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as { id: number; actor_user_id: string | null; action: string; target: string | null; detail: Record<string, unknown> | null; created_at: string }[];
  const dir = await userDirectory(admin, rows.map((r) => r.actor_user_id));
  const when = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const total = count ?? 0;
  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (orgParam) sp.set("org", orgParam);
    if (who) sp.set("who", who);
    if (kind) sp.set("kind", kind.id);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <Section title="Activity and audit log" description={`Changes to this organization's settings, members, clients and credentials. Times in ${timeZone}.`}>
      <form method="get" action={basePath} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
        {orgParam && <input type="hidden" name="org" value={orgParam} />}
        <label className="text-sm font-medium">Who
          <select name="who" defaultValue={who} className={input}>
            <option value="">Anyone</option>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">What
          <select name="kind" defaultValue={kind?.id ?? ""} className={input}>
            <option value="">All changes</option>
            {AUDIT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">From
          <input type="date" name="from" defaultValue={from} className={input} />
        </label>
        <label className="text-sm font-medium">To
          <input type="date" name="to" defaultValue={to} className={input} />
        </label>
        <div className="flex gap-2">
          <button className={btn.primary}>Filter</button>
          {(who || kind || from || to) && <Link href={orgParam ? `${basePath}?org=${orgParam}` : basePath} className={btn.ghost}>Clear</Link>}
        </div>
      </form>

      {error ? <p role="alert" className="text-sm text-negative">The activity log couldn&apos;t be read. Try again.</p>
        : rows.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No activity{who || kind || from || to ? " matches these filters" : " yet"}.</p> : (
          <ol className="divide-y divide-hairline rounded-lg border border-border">
            {rows.map((r) => {
              const actor = r.actor_user_id ? dir.get(r.actor_user_id) : undefined;
              const details = describe(r.detail ?? {});
              return (
                <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-1.5 p-3 sm:flex-nowrap">
                  <time dateTime={r.created_at} className="w-40 shrink-0 text-xs tabular-nums text-muted sm:pt-0.5">{when.format(new Date(r.created_at))}</time>
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    {actor ? <Avatar src={actor.avatarUrl} name={actor.fullName} email={actor.email} size={24} /> : <span className="size-6 shrink-0 rounded-full bg-surface-muted" aria-hidden />}
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{actor ? actor.fullName || actor.email : r.actor_user_id ? "Former user" : "System"}</span>{" "}
                        <span className="text-secondary">{humanize(r.action).toLowerCase()}</span>
                        {r.target && <span className="font-medium"> · {r.target}</span>}
                      </p>
                      {details.length > 0 && <p className="mt-0.5 text-xs text-muted">{details.join(" · ")}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

      {total > PAGE && (
        <nav aria-label="Activity pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={link(page - 1)} className={btn.secondary}>Newer</Link>}
            {page * PAGE < total && <Link href={link(page + 1)} className={btn.secondary}>Older</Link>}
          </span>
        </nav>
      )}
    </Section>
  );
}
