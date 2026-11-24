import { Suspense } from "react";
import Link from "next/link";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenLabel } from "@/lib/aiqw/screens";
import { readItems } from "@/lib/aiqw/store";
import { AskClaude, ScreenRunButton } from "./screen-tools-client";
import { SourceBadge } from "./badges";

/**
 * Bottom of a screen: this screen's AI quick wins (from the shared list), "✨ Quick wins for this screen" and
 * "💬 Ask Claude". `screen` is the key from src/lib/aiqw/screens.ts.
 */
export function AiScreenTools({ screen }: { screen: string | null }) {
  if (!screen) return null;
  // streamed separately: the screen above never waits for it
  return <Suspense fallback={<ToolsSkeleton />}><Tools screen={screen} /></Suspense>;
}

/** Same footprint as the box, so nothing jumps when it arrives. */
function ToolsSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading AI quick wins" className="mt-8 rounded-[10px] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5"><div className="skeleton h-3 w-64 rounded" /><div className="skeleton h-3 w-80 max-w-full rounded" /></div>
        <div className="skeleton h-8 w-48 rounded-lg" />
      </div>
      <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-md" />)}</div>
      <div className="skeleton mt-4 h-9 rounded-lg" />
    </section>
  );
}

async function Tools({ screen }: { screen: string }) {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const items = (await readItems(createAdminClient(), client.id).catch(() => []))
    .filter((w) => w.seen_run && (w.status === "todo" || w.status === "doing") && w.scope_screens.includes(screen))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  return (
    <section aria-labelledby={`ai-${screen}`} className="mt-8 rounded-[10px] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`ai-${screen}`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">AI quick wins and questions for this screen</h2>
          <p className="mt-0.5 text-xs text-muted">{screenLabel(screen)} · written by Claude from this screen&apos;s data; every number comes from the data.</p>
        </div>
        <ScreenRunButton screen={screen} canEdit={canEdit} />
      </div>
      {items.length ? (
        <ol className="mt-3 space-y-2">
          {items.map((w, i) => (
            <li key={w.key} className="flex flex-wrap items-start gap-2 rounded-md border border-hairline p-2.5 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
              <span className="min-w-0 flex-1"><b>{w.title}</b><span className="block text-xs text-muted">{w.where} · {w.plain_summary}</span></span>
              <span className="flex flex-wrap gap-1">{w.sources.slice(0, 3).map((s) => <SourceBadge key={s} s={s} />)}</span>
              <span className="shrink-0 text-xs font-semibold text-positive">+{w.computed_gain} {w.gain_unit}</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-3 text-sm text-muted">0 AI quick wins for this screen yet: press “Quick wins for this screen”.</p>}
      <p className="mt-2 text-xs"><Link href="/ai-quick-wins" className="text-accent underline-offset-2 hover:underline">All AI quick wins, with steps and ready-to-paste text →</Link></p>
      <div className="mt-4 border-t border-hairline pt-3">
        <p className="mb-2 text-sm font-semibold">💬 Ask Claude about this screen</p>
        <AskClaude screen={screen} />
      </div>
    </section>
  );
}
