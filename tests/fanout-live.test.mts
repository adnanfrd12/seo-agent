// Run: npm test. Real AI search queries: reading pasted ChatGPT responses and provider answers (src/lib/fanout/live.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "x";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";
const { parsePasted, parseResponses } = await import("@/lib/fanout/live");

test("ChatGPT conversation JSON: the search queries and cited sites are found", () => {
  const json = JSON.stringify({ mapping: {
    a: { message: { author: { role: "assistant" }, recipient: "web.run", content: { content_type: "code", text: "" }, metadata: { search_queries: [{ type: "search", q: "led signs houston prices" }, { type: "search", q: "best led sign companies houston" }] } } },
    b: { message: { metadata: { search_result_groups: [{ entries: [{ url: "https://ledlightsandsigns.com/houston-led-signs/", title: "LED signs" }, { url: "https://chatgpt.com/x" }] }] } } },
    c: { message: { content: { queries: ["custom outdoor led sign cost"] } } },
  } });
  const r = parsePasted(json);
  assert.deepEqual(r.queries, ["led signs houston prices", "best led sign companies houston", "custom outdoor led sign cost"]);
  assert.deepEqual(r.citations.map((c) => c.url), ["https://ledlightsandsigns.com/houston-led-signs/"], "ChatGPT's own addresses are left out");
});

test("streamed data: lines and plain lists are read too", () => {
  const sse = `data: {"v": {"metadata": {"search_queries": [{"q": "sign permits houston"}]}}}\n\ndata: [DONE]\n`;
  assert.deepEqual(parsePasted(sse).queries, ["sign permits houston"]);
  assert.deepEqual(parsePasted("- led signs houston\n- led sign cost\n").queries, ["led signs houston", "led sign cost"]);
  assert.deepEqual(parsePasted(`garbage {"queries": ["a query", "another"]} more`).queries, ["a query", "another"]);
  assert.deepEqual(parsePasted('{"nothing": true}').queries, []);
});

test("OpenAI-style Responses answer: web_search_call queries, sources and citations", () => {
  const r = parseResponses({
    output: [
      { type: "web_search_call", action: { type: "search", query: "led signs houston", sources: [{ url: "https://a.example/x" }] } },
      { type: "web_search_call", action: { type: "search", queries: ["led sign prices 2026", "led signs houston"] } },
      { type: "search_results", queries: ["houston sign companies"], results: [{ url: "https://b.example/", title: "B" }] },
      { type: "message", content: [{ type: "output_text", text: "Here are options…", annotations: [{ type: "url_citation", url: "https://c.example/", title: "C" }] }] },
    ],
  });
  assert.deepEqual(r.queries, ["led signs houston", "led sign prices 2026", "houston sign companies"]);
  assert.deepEqual(r.citations.map((c) => c.url).sort(), ["https://a.example/x", "https://b.example/", "https://c.example/"]);
  assert.equal(r.answer, "Here are options…");
});
