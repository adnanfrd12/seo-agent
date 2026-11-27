// Run: npm test. Page access per organization (src/lib/org/pages.ts) and Nova's page map (src/lib/nova/pages.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "x";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.CRON_SECRET ??= "0123456789abcdef0123";
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { NAV } = await import("@/lib/analytics/nav");
const { filterNav, firstAllowedHref, navHrefs, normalizeEnabledPages, pageAllowed } = await import("@/lib/org/pages");
const { TOOL_PAGES, VIEW_PAGES, toolAllowed, viewAllowed } = await import("@/lib/nova/pages");
const { toolNames } = await import("@/lib/nova/tools");
const { DATA_VIEWS } = await import("@/lib/ai/intelligence");

test("every page is open when an organization has no page list", () => {
  for (const href of navHrefs()) assert.equal(pageAllowed(null, href), true, href);
  assert.equal(filterNav(NAV, null), NAV);
});

test("turned-off pages are blocked, settings and pages outside the sidebar stay open", () => {
  const enabled = ["/overview", "/rank-tracking", "/search-console", "/search-console/queries"];
  assert.equal(pageAllowed(enabled, "/overview"), true);
  assert.equal(pageAllowed(enabled, "/rank-tracking/"), true);
  assert.equal(pageAllowed(enabled, "/rank-tracking?range=30"), true);
  assert.equal(pageAllowed(enabled, "/backlinks"), false);
  assert.equal(pageAllowed(enabled, "/search-console/queries"), true);
  assert.equal(pageAllowed(enabled, "/search-console/pages"), false, "a sub-tab is gated on its own");
  for (const open of ["/settings", "/settings/organization/team", "/integrations", "/invite/abc", "/report", "/api/nova/chat"]) {
    assert.equal(pageAllowed(enabled, open), true, open);
  }
  assert.equal(pageAllowed([], "/overview"), false, "an empty list turns every gated page off");
  assert.equal(firstAllowedHref([]), "/settings", "with nothing enabled people land on Settings, never in a redirect loop");
  assert.equal(firstAllowedHref(["/backlinks"]), "/backlinks");
});

test("the sidebar only shows enabled pages, and a section keeps its allowed sub-tabs", () => {
  const nav = filterNav(NAV, ["/overview", "/search-console/queries"]);
  const hrefs = nav.flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]));
  assert.ok(hrefs.includes("/overview"));
  assert.ok(hrefs.includes("/search-console/queries"));
  assert.ok(!hrefs.includes("/backlinks"));
  assert.ok(!hrefs.includes("/search-console/pages"));
  assert.ok(hrefs.includes("/settings") && hrefs.includes("/integrations"), "administration pages always stay");
  const gsc = nav.flatMap((g) => g.items).find((i) => i.label === "Google Search Console");
  assert.equal(gsc?.href, "/search-console/queries", "the section link moves to its first allowed sub-tab");
  assert.deepEqual(normalizeEnabledPages(["/nope", "/backlinks", "/overview", "/overview", "/settings"]), ["/overview", "/backlinks"]);
});

test("Nova's page map names real tools, data views and sidebar pages", () => {
  const tools = new Set(toolNames());
  const hrefs = new Set(navHrefs());
  for (const [tool, pages] of Object.entries(TOOL_PAGES)) {
    assert.ok(tools.has(tool), `unknown Nova tool in TOOL_PAGES: ${tool}`);
    for (const p of pages) assert.ok(hrefs.has(p), `${tool}: ${p} is not a sidebar page`);
  }
  for (const v of DATA_VIEWS) assert.ok(VIEW_PAGES[v.key], `data view without pages: ${v.key}`);
  for (const [view, pages] of Object.entries(VIEW_PAGES)) for (const p of pages) assert.ok(hrefs.has(p), `${view}: ${p} is not a sidebar page`);
});

test("Nova offers only the tools and data of enabled pages", () => {
  assert.equal(toolAllowed("get_rank_tracking", null), true);
  assert.equal(toolAllowed("get_rank_tracking", ["/overview"]), false);
  assert.equal(toolAllowed("get_rank_tracking", ["/rank-tracking"]), true);
  assert.equal(toolAllowed("get_research_results", ["/competitors"]), true, "a tool with several pages needs any one of them");
  assert.equal(toolAllowed("get_client_settings", []), true, "tools not tied to a page are always available");
  assert.equal(viewAllowed("backlinks", ["/overview"]), false);
  assert.equal(viewAllowed("search_console_queries", ["/search-console/queries"]), true);
});
