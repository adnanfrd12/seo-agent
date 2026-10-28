import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { marketLabel } from "@/lib/dataforseo/locations";
import type { LinkSpike } from "@/lib/dataforseo/research";
import { TargetForm } from "./controls";

/** "Today's API spend" line, shown to owners and admins only. */
export function SpendLine({ budget }: { budget: { spent: number; cap: number; balance: number | null } | null }) {
  if (!budget) return null;
  const pct = Math.min(100, (budget.spent / budget.cap) * 100);
  return (
    <p className="text-xs text-muted">
      API spend today ${budget.spent.toFixed(2)} of ${budget.cap.toFixed(2)} daily cap
      <span className="mx-1.5 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted align-middle"><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
      {budget.balance != null && <>· DataForSEO balance ${budget.balance.toFixed(2)} · </>}
      <Link href="/integrations" className="text-accent hover:underline">spend details</Link>
    </p>
  );
}

export function TargetSettings({ canEdit, target }: {
  canEdit: boolean; target: { domain: string; location_code: number; auto_refresh: boolean; competitors: string[] };
}) {
  return (
    <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Website: <span className="font-semibold">{target.domain}</span> · {marketLabel(target.location_code)} · {target.auto_refresh ? "weekly auto-refresh on" : "auto-refresh off"}
        <span className="ml-2 text-accent">{canEdit ? "Change" : "View"}</span>
      </summary>
      <div className="mt-3"><TargetForm canEdit={canEdit} domain={target.domain} location={target.location_code} autoRefresh={target.auto_refresh} competitors={target.competitors} /></div>
    </details>
  );
}

export function SpikeAlert({ spike }: { spike: LinkSpike }) {
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-negative/40 bg-negative/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-negative" aria-hidden />
      <div>
        <p className="font-semibold text-negative">Unusual jump in new links in {spike.month}</p>
        <p className="mt-1">
          {spike.newDomains.toLocaleString("en-US")} new referring domains and {spike.newBacklinks.toLocaleString("en-US")} new backlinks, versus a usual {spike.baseline.toLocaleString("en-US")} new domains a month
          ({Math.round(spike.ratio)}× normal). A spike this size is usually a link farm, spam or negative SEO rather than real growth. Check the <strong>Anchors</strong> and
          <strong> Referring domains</strong> tabs (sort by spam score) and consider disavowing the spammy domains in Google Search Console.
        </p>
      </div>
    </div>
  );
}
