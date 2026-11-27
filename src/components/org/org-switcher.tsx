"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building, Check, ChevronsUpDown, Loader2, Settings } from "lucide-react";
import { switchOrganization } from "@/app/(dashboard)/settings/organization/actions";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, type OrgRoleId } from "./labels";

export interface OrgSwitcherItem { id: string; name: string; role: OrgRoleId }

/**
 * The active organization (name and your role) with a menu to switch to another one. Switching opens that
 * organization's first client you can reach; an organization without clients opens its Clients settings instead.
 *
 * Usage (server layout): const { organizations, organization } = await getSession();
 *   <OrgSwitcher organizations={organizations} activeId={organization?.id ?? null} />
 * Renders nothing for someone without an organization.
 */
export function OrgSwitcher({ organizations, activeId, compact = false, className, redirectTo }: {
  organizations: OrgSwitcherItem[]; activeId: string | null; compact?: boolean; className?: string;
  /** where to go after switching (default: the organization's dashboard) */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const active = organizations.find((o) => o.id === activeId) ?? organizations[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!active) return null;
  const settingsHref = (id: string) => (id === activeId ? "/settings/organization/general" : `/settings/organization/general?org=${id}`);

  const pick = (id: string) => start(async () => {
    setError(null);
    const r = await switchOrganization(id);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    if (r.empty) router.push(`/settings/organization/clients?org=${id}`);
    else { router.push(redirectTo ?? "/overview"); router.refresh(); }
  });

  return (
    <div ref={root} className={cn("relative min-w-0", className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Organization: ${active.name}. Switch organization`}
        className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg text-left outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent",
          compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-muted text-secondary">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Building className="size-3.5" aria-hidden />}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{active.name}</span>
            <span className="block truncate text-[11px] text-muted">{ROLE_LABEL[active.role]}</span>
          </span>
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1.5 w-[260px] overflow-hidden rounded-lg border border-border bg-surface shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]">
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-faint">Organizations</p>
          <ul role="listbox" aria-label="Organizations" className="max-h-72 overflow-y-auto p-1">
            {organizations.map((o) => (
              <li key={o.id}>
                <button type="button" role="option" aria-selected={o.id === active.id} disabled={pending}
                  onClick={() => (o.id === active.id ? setOpen(false) : pick(o.id))}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-muted", o.id === active.id && "font-medium")}>
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="text-xs text-muted">{ROLE_LABEL[o.role]}</span>
                  {o.id === active.id && <Check className="size-4 text-accent" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-1">
            <Link href={settingsHref(active.id)} onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-secondary hover:bg-surface-muted hover:text-foreground">
              <Settings className="size-4" aria-hidden /> Organization settings
            </Link>
          </div>
          {error && <p role="alert" className="px-3 pb-2.5 text-xs text-negative">{error}</p>}
        </div>
      )}
    </div>
  );
}
