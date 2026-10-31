"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { markAlertsSeen } from "@/app/(dashboard)/research-actions";
import type { AlertRow } from "@/lib/alerts";
import { cn } from "@/lib/utils";

const STYLE = {
  critical: { dot: "bg-negative", label: "Critical" },
  warning: { dot: "bg-warn", label: "Warning" },
  positive: { dot: "bg-positive", label: "Good news" },
  info: { dot: "bg-series", label: "Info" },
} as const;

const ago = (iso: string) => {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** Significant changes detected by the daily check, newest first. */
export function AlertsPanel({ alerts }: { alerts: AlertRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unseen = alerts.filter((a) => !a.seen_at).length;
  return (
    <section className="overflow-hidden rounded-[10px] border border-border bg-surface" aria-labelledby="alerts-h">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <h2 id="alerts-h" className="flex items-center gap-2 text-[15px] font-semibold">Alerts {unseen > 0 && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">{unseen} new</span>}</h2>
        {unseen > 0 && <button className="text-[13px] font-medium text-secondary hover:text-foreground disabled:opacity-60" disabled={pending} onClick={() => start(async () => { await markAlertsSeen(); router.refresh(); })}>Mark all read</button>}
      </div>
      {alerts.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5">Nothing unusual. A daily check watches traffic, rankings, links, reviews, competitors and data syncs, and reports significant changes here.</p>
      ) : (
        <ul>
          {alerts.slice(0, 6).map((a) => {
            const s = STYLE[a.severity] ?? STYLE.info;
            return (
              <li key={a.id} className="flex gap-3 border-t border-hairline px-4 py-2.5 first:border-t-0 sm:px-5">
                <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", s.dot)} role="img" aria-label={s.label} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className={cn("leading-snug", !a.seen_at && "font-medium")}>{a.title}</p>
                  {a.body && <p className="mt-0.5 text-[13px] leading-relaxed text-secondary">{a.body}</p>}
                  <p className="mt-1 text-xs text-muted">{s.label} · {ago(a.created_at)}{!a.seen_at && <span className="ml-1.5 font-medium text-foreground">· new</span>}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
