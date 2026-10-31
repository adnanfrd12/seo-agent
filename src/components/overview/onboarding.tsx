import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { SourceStatus } from "@/lib/overview/status";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "ga4", label: "Google Analytics 4", why: "Shows who visits the site, how they behave and which actions they take.", keys: ["ga4"] },
  { key: "gsc", label: "Google Search Console", why: "Shows the searches that bring people to you, with rankings and clicks.", keys: ["gsc"] },
  { key: "gbp", label: "Business Profile", why: "Shows local views, calls, directions and reviews.", keys: ["lbm", "gbp"] },
  { key: "bing", label: "Bing Webmaster Tools", why: "Adds Bing search performance and crawl health.", keys: ["bing"] },
  { key: "clarity", label: "Microsoft Clarity", why: "Shows where visitors get stuck on the site.", keys: ["clarity"] },
  { key: "dfs", label: "Rankings, links and competitors", why: "Backlinks, organic keywords and daily competitor analysis (DataForSEO).", keys: ["dfs"] },
] as const;

/** Connection checklist: what is already feeding the dashboard and what a click on Integrations would add. */
export function Onboarding({ status }: { status: SourceStatus[] }) {
  const have = new Set(status.map((s) => s.key));
  const done = STEPS.filter((s) => s.keys.some((k) => have.has(k)));
  if (done.length === STEPS.length) return null;
  return (
    <details open={done.length < 3} className="rounded-[10px] border border-border bg-surface">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-medium sm:px-5">
        <span>Complete your setup <span className="ml-1 font-normal text-muted">{done.length} of {STEPS.length} data sources connected</span></span>
        <span className="h-1 w-28 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full bg-positive" style={{ width: `${(done.length / STEPS.length) * 100}%` }} /></span>
      </summary>
      <ul className="grid gap-2 border-t border-hairline p-4 sm:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((s) => {
          const ok = s.keys.some((k) => have.has(k));
          return (
            <li key={s.key}>
              <Link href="/integrations" className={cn("lift flex h-full gap-3 rounded-lg border border-border p-3 text-sm", ok && "bg-surface-sunken")}>
                {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-label="Connected" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Not connected" />}
                <span><span className="font-medium">{s.label}</span><span className="block text-xs text-muted">{ok ? "Connected and syncing automatically." : s.why}</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
