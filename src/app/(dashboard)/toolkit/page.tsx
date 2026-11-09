import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TabHeader } from "@/components/dashboard/tab-header";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { toolHref, TOOLS } from "@/lib/toolkit/tools";

/** SEO Toolkit hub: every on-demand tool as a card. Tools are registered in src/lib/toolkit/tools.ts. */
export default async function ToolkitPage() {
  const { client } = await getSession();
  if (!client) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("dfs_cache").select("endpoint, fetched_at").eq("client_id", client.id).like("endpoint", "tk_%");
  const last = new Map((data ?? []).map((r) => [String(r.endpoint).slice(3), String(r.fetched_at)]));
  const ran = TOOLS.filter((t) => last.has(t.slug)).length;
  return (
    <>
      <TabHeader source={null} title="SEO Toolkit" description="On-demand SEO tools that run on this client's real website and stored data. Each run is saved with its date and cost, and opening a tool never spends anything." guide={[
        { term: "Run", text: "Owners and admins run a tool with its button. Paid steps (Google searches, AI) go through the daily API budget and show their cost first." },
        { term: "Method", text: "Checks, thresholds and page structures adapted from the open-source claude-seo skills (MIT licence)." },
      ]} />
      <p className="mb-4 text-xs text-muted">{TOOLS.length} tools · {ran} run for this client</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((t) => {
          const at = last.get(t.slug);
          return (
            <Link key={t.slug} href={toolHref(t)} className="group flex min-w-0 flex-col rounded-[10px] border border-border bg-surface p-5 transition hover:border-border-strong hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[15px] font-semibold">{t.title}</h2>
                <ArrowRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-secondary">{t.description}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="rounded-md bg-surface-muted px-2 py-0.5">{t.source}</span>
                <span>{t.slug.startsWith("/") ? "Existing page" : at ? `Last run ${at.slice(0, 10)}` : "Not run yet"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
