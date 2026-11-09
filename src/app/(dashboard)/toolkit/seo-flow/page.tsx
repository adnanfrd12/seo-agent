import { TabHeader } from "@/components/dashboard/tab-header";
import { BackToToolkit } from "@/components/toolkit/bits";
import { FlowLibrary, type FlowPrompt } from "@/components/toolkit/flow-library";
import { loadBlog } from "@/lib/blog/load";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { loadScan, TK, type ProgrammaticData } from "@/lib/toolkit/site-scan";
import prompts from "@/lib/toolkit/flow-prompts.json";

/**
 * FLOW prompt library. Prompts © Daniel Agrici, licensed CC BY 4.0 (github.com/AgriciDaniel/flow), as bundled in the
 * MIT-licensed claude-seo seo-flow skill (github.com/AgricIDaniel/claude-seo). Text reproduced unchanged; attribution shown on the page.
 */
export default async function FlowPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, cache } = page;
  const supabase = await createClient();
  const [prog, blog] = await Promise.all([loadScan<ProgrammaticData>(supabase, client.id, TK.programmatic), loadBlog(supabase, client.id)]);
  const areas = new Map<string, number>();
  for (const p of blog.posts) if (p.geo?.neighborhood) areas.set(p.geo.neighborhood, (areas.get(p.geo.neighborhood) ?? 0) + 1);
  const city = blog.posts.find((p) => p.geo?.city)?.geo?.city ?? null;
  const domain = cache.target?.domain ?? null;
  const business = domain ? `${client.name} (${domain})` : client.name;
  const context = [
    "Client context:",
    `- Business: ${client.name}`, domain ? `- Website: https://${domain}/` : "", city ? `- Main city: ${city}` : "",
    areas.size ? `- Areas served (from blog): ${[...areas].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a]) => a).join(", ")}` : "",
    prog?.data.services.length ? `- Service pages: ${prog.data.services.slice(0, 12).map((s) => s.title).join(", ")}` : "",
  ].filter(Boolean).join("\n");
  return (
    <>
      <BackToToolkit />
      <TabHeader source={null} title="FLOW Prompt Library" description="41 evidence-led AI prompts organised by the FLOW loop: Find, Leverage, Optimize, Win, plus Local. Pick a stage, copy a prompt (with this client's details filled in) and paste it into Claude or ChatGPT with your evidence." guide={[
        { term: "Find", text: "Keyword research, audience, topical planning and prioritisation." },
        { term: "Leverage", text: "Backlinks and off-site authority." },
        { term: "Optimize", text: "On-page rewrites, schema, CTR, content audits, AI visibility." },
        { term: "Win", text: "Bottom-of-funnel pages, conversion and the dual-surface (Google + AI) scorecard." },
        { term: "Local", text: "Business Profile categories, services, descriptions, titles, meta and local page rewrites." },
        { term: "Licence", text: "Framework and prompts © Daniel Agrici, CC BY 4.0 (github.com/AgriciDaniel/flow), via the MIT-licensed claude-seo project. Reproduced unchanged; client context is appended, not edited in." },
      ]} />
      <FlowLibrary prompts={prompts as FlowPrompt[]} business={business} context={context} />
      <p className="mt-6 text-xs text-muted">FLOW framework and prompts © Daniel Agrici, licensed under <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Source: <a className="underline" href="https://github.com/AgriciDaniel/flow" target="_blank" rel="noreferrer">github.com/AgriciDaniel/flow</a>, bundled in <a className="underline" href="https://github.com/AgricIDaniel/claude-seo" target="_blank" rel="noreferrer">claude-seo</a> (MIT). Changes: the only change is the &quot;[BUSINESS OR ASSET]&quot; placeholder filled in and client context appended when that option is on.</p>
    </>
  );
}
