import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { SourceBadge } from "@/components/aiqw/badges";
import { Band, Card, Grid } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODELS } from "@/lib/aiqw/settings";
import { SOURCE_INFO } from "@/lib/aiqw/sources-info";
import { listRuns } from "@/lib/aiqw/store";
import { SOURCES } from "@/lib/aiqw/types";

/** The sample page's tabs (its "Build prompt" tab is intentionally not part of the portal). */
const TABS = [["#flow", "How it works"], ["/ai-quick-wins#generate", "Try the button"], ["#sources", "What each source adds"], ["#buttons", "Buttons in the portal"], ["#rules", "Rules that keep it accurate"], ["#cost", "Cost"]] as const;
const Anchor = ({ id }: { id: string }) => <span id={id} className="block scroll-mt-20" aria-hidden />;

const FLOW = [
  { n: 1, title: "Click", text: "“Generate quick wins” for the whole site, one screen or one page. Or the nightly schedule." },
  { n: 2, title: "Collect fresh data", text: "Search Console and GA4 re-sync when older than a day; Deep and nightly runs refresh DataForSEO.", src: ["gsc", "ga4", "gbp", "bing", "clarity", "dataforseo", "crawl"] as const },
  { n: 3, title: "Find candidates", text: "Fixed rules find opportunities and calculate every number: impressions, positions, CTR gaps, lead rates, search volume, estimated gain." },
  { n: 4, title: "Claude writes the plan", text: "Gets the candidates as JSON and returns structured quick wins: title, where, why, steps, suggested text, confidence.", claude: true },
  { n: 5, title: "Check", text: "Code validates the JSON, rejects pages or numbers that aren't in the data (repairs once), and re-ranks by gain ÷ effort." },
  { n: 6, title: "Save and show", text: "This tab, each screen's task list, the runs log and the morning email. “Done” status kept between runs." },
];
const BUTTONS = [
  { b: "✨ Generate quick wins", where: "AI Quick Wins page. Whole site, all sources. Shows the last run and what changed since (new, resolved, still open).", href: "/ai-quick-wins" },
  { b: "✨ Quick wins for this screen", where: "Bottom of the GA4 and Search Console screens. Re-runs only that screen's rules, so it's fast and cheap." },
  { b: "✨ Analyze this page", where: "Scope “One page” with Deep depth: one page, all sources, today's Google results for its top queries through DataForSEO.", href: "/ai-quick-wins" },
  { b: "✨ Ask Nova about this page", where: "Nova, bottom right of every dashboard page. “Ask about this page” reads the data that screen shows and answers from it, quoting the numbers." },
  { b: "⏰ Nightly run", where: "AI and data settings. Every night with the Message Batches API (half price), ready for the morning email.", href: "/ai-quick-wins/settings" },
  { b: "⬇ Import data", where: "AI and data settings. Re-syncs Search Console and GA4 and queues Bing, Clarity and Business Profile, then offers to regenerate.", href: "/ai-quick-wins/settings" },
];
const RULES = [
  ["Code calculates, Claude writes", "Every number (impressions, positions, gains, volumes) is computed in code and sent to Claude. Claude may only quote numbers it was given; a sentence with any other number is sent back once for repair, then dropped."],
  ["Checked before saving", "The answer must match a strict JSON schema (structured outputs). Any page URL or candidate ID that isn't in the data is rejected; titles outside 50–60 and meta descriptions outside 140–160 characters (±5) are repaired or dropped."],
  ["No invented facts", "Prices, certifications, years or ratings that aren't in the business profile are written as [placeholders] for the owner to fill in. No fake reviews or self-declared ratings."],
  ["Keys stay on the server", "Anthropic, Google, Microsoft, social and DataForSEO keys live in server environment variables or encrypted in the database. The browser only calls the portal."],
  ["Status survives re-runs", "Each quick win has a stable key (rule + page + query), so “done” and “dismissed” stay put and results are measured 28 days later against the stored baseline."],
  ["Cost control", "DataForSEO data cached for 24 hours and fetched only in Deep and nightly runs, the instructions prompt-cached, a per-client monthly Claude budget and DataForSEO limit, checked before every run."],
  ["Privacy", "Claude gets only aggregated SEO, analytics and social statistics and public page content: never form contents, lead emails or phone numbers, reviewer names or tokens."],
];

export default async function HowItWorksPage() {
  const { client } = await getSession();
  if (!client) return null;
  const runs = (await listRuns(createAdminClient(), client.id, 50)).filter((r) => r.status === "done" && r.usage.calls > 0);
  const avg = (f: (r: (typeof runs)[number]) => boolean) => { const xs = runs.filter(f); return xs.length ? xs.reduce((a, r) => a + r.usage.cost, 0) / xs.length : null; };
  const site = avg((r) => r.scope.kind === "site" && r.trigger === "manual"), screen = avg((r) => r.scope.kind === "screen"), page = avg((r) => r.scope.kind === "page"), nightly = avg((r) => r.trigger === "nightly");
  const costs = [
    ["Whole site, on demand", site, "measured over 8 chunks of about 12 candidates; 2–4 minutes"],
    ["One screen", screen, "up to 40 candidates; under a minute"],
    ["One page, Deep", page, "plus DataForSEO live results (about $0.002 per keyword)"],
    ["Nightly, per client (Batch API)", nightly, "half price, ready by morning"],
  ] as const;
  return (
    <>
      <PageHeader title="How AI quick wins work" description="Press one button and the portal gathers the latest data from every connected platform, works out every number in code, and has Claude (through the Claude API) turn it into a ranked to-do list with exact pages, places on the page, queries and ready-to-paste text." />
      <nav aria-label="On this page" className="-mt-2 mb-4 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {TABS.map(([href, label]) => <Link key={href} href={href} className="shrink-0 rounded-t-md px-3 py-2 text-sm text-secondary hover:bg-surface-muted hover:text-foreground">{label}</Link>)}
      </nav>
      <Anchor id="flow" />
      <Band title="How it works" sub="Code collects and calculates. Claude reads the facts, picks the best actions and writes them up. Code checks Claude's answer before anything is saved." />
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {FLOW.map((f) => (
          <li key={f.n} className={`rounded-[10px] border p-3.5 ${f.claude ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}>
            <span className="grid size-6 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{f.n}</span>
            <h3 className="mt-2 text-sm font-semibold">{f.title}</h3>
            <p className="mt-1 text-[13px] text-secondary">{f.text}</p>
            {f.src && <div className="mt-2 flex flex-wrap gap-1">{f.src.map((s) => <SourceBadge key={s} s={s} />)}</div>}
            {f.claude && <div className="mt-2"><SourceBadge s="claude" /></div>}
          </li>
        ))}
      </ol>
      <Anchor id="sources" />
      <Band title="What each source adds" sub="Each quick win shows which sources its evidence came from, so you can see why it was suggested." />
      <Grid>
        <Card title="Sources" sub={<Link href="/ai-quick-wins/sources" className="underline">See which ones hold data for this client</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead><tr className="border-b border-border text-xs text-muted"><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">What it adds to quick wins</th><th className="py-2 font-medium">Example</th></tr></thead>
              <tbody>
                {SOURCES.map((s) => <tr key={s} className="border-b border-hairline align-top"><td className="py-2 pr-3"><SourceBadge s={s} /></td><td className="py-2 pr-3">{SOURCE_INFO[s].adds}</td><td className="py-2 text-xs text-muted">{SOURCE_INFO[s].example}</td></tr>)}
                <tr className="align-top"><td className="py-2 pr-3"><SourceBadge s="claude" /></td><td className="py-2 pr-3">Chooses and prioritises, writes the title, the steps and the suggested text, explains why in plain words, groups related changes. Never invents numbers or pages.</td><td className="py-2 text-xs text-muted">Rewrite the title to: Channel Letters in Houston | LED Lights and Signs</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      </Grid>
      <Anchor id="buttons" />
      <Band title="Buttons in the portal" sub="One engine, called from several places with a different scope." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BUTTONS.map((b) => (
          <div key={b.b} className="rounded-[10px] border border-border bg-surface p-3.5">
            <span className="inline-flex rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-medium">{b.b}</span>
            <p className="mt-2 text-[13px] text-secondary">{b.where} {b.href && <Link href={b.href} className="text-accent underline-offset-2 hover:underline">Open</Link>}</p>
          </div>
        ))}
      </div>
      <Anchor id="rules" />
      <Band title="Rules that keep it accurate" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RULES.map(([t, d]) => <div key={t} className="rounded-[10px] border border-border bg-surface p-3.5"><h3 className="text-sm font-semibold">{t}</h3><p className="mt-1 text-[13px] text-secondary">{d}</p></div>)}
      </div>
      <Anchor id="cost" />
      <Band title="Cost per run" sub={`Claude Opus 5.5 at $${MODELS["claude-opus-5-5"].input} per million input tokens and $${MODELS["claude-opus-5-5"].output} per million output tokens; Sonnet 5.5 at $${MODELS["claude-sonnet-5-5"].input} / $${MODELS["claude-sonnet-5-5"].output}. Real costs come from this client's logged runs; 0 means no run of that kind yet.`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {costs.map(([l, v, n]) => <div key={l} className="rounded-[10px] border border-border bg-surface p-3.5"><p className="text-[13px] text-muted">{l}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{v != null ? `$${v.toFixed(2)}` : "$0"}</p><p className="mt-1 text-xs text-muted">{v != null ? "average of logged runs" : "no run yet"} · {n}</p></div>)}
      </div>
      <p className="mt-3 text-xs text-muted">Output is the main cost: each kept quick win is about 900 output tokens of title, steps and ready-to-paste text. The engine logs real token use per run on <Link href="/ai-quick-wins/runs" className="underline">Runs and spend</Link>.</p>
    </>
  );
}
