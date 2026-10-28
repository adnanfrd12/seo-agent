"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, CheckCircle2, Info, Siren } from "lucide-react";
import { markAlertsSeen } from "@/app/(dashboard)/research-actions";
import type { AlertRow } from "@/lib/alerts";
import { cn } from "@/lib/utils";

const STYLE = {
  critical: { icon: Siren, cls: "text-negative bg-negative/10", label: "Critical" },
  warning: { icon: AlertTriangle, cls: "text-[#B7791F] bg-[#D4970A]/10", label: "Warning" },
  positive: { icon: CheckCircle2, cls: "text-positive bg-positive/10", label: "Good news" },
  info: { icon: Info, cls: "text-accent bg-accent-soft", label: "Info" },
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
    <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="alerts-h">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="alerts-h" className="flex items-center gap-2 text-sm font-semibold"><BellRing className="size-4 text-accent" aria-hidden /> Alerts {unseen > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">{unseen} new</span>}</h2>
        {unseen > 0 && <button className="text-xs text-accent hover:underline disabled:opacity-60" disabled={pending} onClick={() => start(async () => { await markAlertsSeen(); router.refresh(); })}>Mark all read</button>}
      </div>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted">Nothing unusual. A daily check watches traffic, rankings, links, reviews, competitors and data syncs, and reports significant changes here.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.slice(0, 6).map((a) => {
            const s = STYLE[a.severity] ?? STYLE.info;
            return (
              <li key={a.id} className={cn("flex gap-3 rounded-lg border border-border p-3", !a.seen_at && "border-l-2 border-l-accent")}>
                <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full", s.cls)}><s.icon className="size-4" aria-hidden /></span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium leading-snug">{a.title}</p>
                  {a.body && <p className="mt-0.5 text-xs text-muted">{a.body}</p>}
                  <p className="mt-1 text-[11px] text-muted">{s.label} · {ago(a.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
