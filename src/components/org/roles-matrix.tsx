import { Check, Minus } from "lucide-react";
import { can, ORG_ROLES, type OrgRole } from "@/lib/org/permissions";
import { ROLE_HINT, ROLE_LABEL } from "./labels";
import { Section } from "./section";

type Cell = boolean | string;
/** Organization-level rows come straight from permissions.ts, so the table can't drift from what the server enforces. */
const ROWS: { label: string; cell: (r: OrgRole) => Cell }[] = [
  { label: "Manage integration credentials (API keys, secrets)", cell: (r) => can.manageCredentials(r) },
  { label: "Edit organization details, branding and preferences", cell: (r) => can.manageSettings(r) },
  { label: "Invite people, change roles, deactivate or remove members", cell: (r) => (can.manageMembers(r) ? (r === "owner" ? true : "Not owners") : false) },
  { label: "Make someone an owner", cell: (r) => r === "owner" },
  { label: "Create, edit, archive and restore clients", cell: (r) => can.manageClients(r) },
  { label: "Choose which clients each person can open", cell: (r) => can.manageClients(r) },
  { label: "See the activity and audit log", cell: (r) => can.viewAudit(r) },
  { label: "See AI and tools spend", cell: (r) => can.viewAudit(r) },
  { label: "Open clients", cell: (r) => (r === "owner" || r === "admin" ? "All" : "Assigned") },
  { label: "Change data inside a client (connections, reports, tasks)", cell: (r) => (r === "owner" || r === "admin" ? true : r === "member" ? "If “Can edit”" : false) },
  { label: "View reports and dashboards", cell: () => true },
];

function Mark({ v }: { v: Cell }) {
  if (v === true) return <Check className="mx-auto size-4 text-positive" aria-label="Yes" />;
  if (v === false) return <Minus className="mx-auto size-4 text-faint" aria-label="No" />;
  return <span className="text-xs text-secondary">{v}</span>;
}

/** Settings → Organization → Roles and permissions (read-only). */
export function RolesMatrix() {
  return (
    <div className="space-y-6">
      <Section title="Roles" description="Every person in the organization has one role. Team members and viewers also have a role per client.">
        <dl className="grid gap-3 sm:grid-cols-2">
          {ORG_ROLES.map((r) => (
            <div key={r} className="rounded-lg border border-border p-3">
              <dt className="text-sm font-semibold">{ROLE_LABEL[r]}</dt>
              <dd className="mt-0.5 text-sm text-secondary">{ROLE_HINT[r]}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="What each role can do" description="Checked on the server for every action, whatever the screen shows.">
        <div className="-mx-5 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="py-2 pl-5 pr-3 font-medium sm:pl-0">Permission</th>
                {ORG_ROLES.map((r) => <th key={r} scope="col" className="w-24 px-2 py-2 text-center font-medium">{ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="py-2.5 pl-5 pr-3 text-left font-normal sm:pl-0">{row.label}</th>
                  {ORG_ROLES.map((r) => <td key={r} className="px-2 py-2.5 text-center"><Mark v={row.cell(r)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted">
          Per client, a team member is either <strong>Can edit</strong> or <strong>View only</strong>; viewers are always view only. Nobody can change their own role,
          only owners manage owners, and an organization always keeps at least one owner. Platform administrators decide which pages the organization can use.
        </p>
      </Section>
    </div>
  );
}
