import { cn } from "@/lib/utils";
import { ROLE_LABEL, type OrgRoleId } from "./labels";
import { card, pill } from "./styles";

/** A settings card: title, optional description and action, then the content. Works in server and client components. */
export function Section({ title, description, action, children, className }: {
  title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn(card, className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const ROLE_TONE: Record<OrgRoleId, string> = {
  owner: "bg-accent-soft text-accent",
  admin: "bg-series-soft text-series",
  member: "bg-surface-muted text-foreground",
  viewer: "bg-surface-muted text-secondary",
};
export function RoleBadge({ role }: { role: OrgRoleId }) {
  return <span className={cn(pill, ROLE_TONE[role])}>{ROLE_LABEL[role]}</span>;
}

export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" | "negative" }) {
  return (
    <p className={cn("rounded-lg px-3 py-2 text-sm",
      tone === "warn" ? "bg-warn-soft text-warn" : tone === "negative" ? "bg-negative-soft text-negative" : "bg-surface-muted text-secondary")}>
      {children}
    </p>
  );
}
