// Setup guides (src/lib/org/guides.ts) and their PDF document (src/components/org/guides/pdf-document.ts).
// Run: npm test (no network, no database, no browser).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";

const { INTEGRATIONS } = await import("@/lib/org/registry");
const { allGuides, guideCoverage, guideFor, guideIds, guideIntro, hasGuide, inlineTokens, GUIDES_UPDATED, GUIDES_VERSION } = await import("@/lib/org/guides");
const { documentEntries, guideDocumentHtml, inline, measuredBlocks } = await import("@/components/org/guides/pdf-document");
const { countPdfPages } = await import("@/app/api/org/guides/_lib/render");

const APP = "https://app.example.test";
const ctx = { appUrl: `${APP}/`, appName: "Acme Insights", orgName: "Acme Agency" };

test("every registry integration has a setup guide (add one in src/lib/org/guides.ts when you add an integration)", () => {
  const cov = guideCoverage();
  assert.deepEqual(cov.missingGuides, [], `integrations without a guide: ${cov.missingGuides.join(", ")}`);
  assert.deepEqual(cov.unknownGuides, [], `guides for ids that aren't in the registry: ${cov.unknownGuides.join(", ")}`);
  for (const def of INTEGRATIONS) {
    assert.equal(hasGuide(def.id), true, def.id);
    const g = guideFor(def.id, ctx);
    assert.ok(g, `guideFor(${def.id})`);
    assert.equal(g.name, def.name);
    assert.deepEqual(g.features, def.features);
    for (const [what, v] of Object.entries({ purpose: g.purpose, cost: g.cost, time: g.time })) assert.ok(v.trim().length >= 4, `${def.id}.${what}`);
    assert.ok(g.parts.length > 0 || g.enter.steps.length > 0, `${def.id}: steps`);
    assert.ok(g.enter.steps.length > 0, `${def.id}: where to enter it`);
    assert.ok(g.test.length > 0, `${def.id}: how to test`);
    assert.ok(g.problems.length > 0, `${def.id}: troubleshooting`);
    assert.ok(g.renewal.length > 0, `${def.id}: expiry and renewal`);
    assert.ok(g.checklist.length > 0, `${def.id}: checklist`);
  }
  assert.deepEqual(guideIds(), INTEGRATIONS.map((i) => i.id), "guides follow the registry order");
  assert.equal(allGuides(ctx).length, INTEGRATIONS.length);
  assert.equal(guideFor("not-an-integration"), null);
});

test("every credential field says where its value comes from, with the registry's label and key", () => {
  const cov = guideCoverage();
  assert.deepEqual(cov.missingFields, [], `fields without a source: ${cov.missingFields.join(", ")}`);
  assert.deepEqual(cov.unknownFields, [], `notes for keys that aren't in the registry: ${cov.unknownFields.join(", ")}`);
  for (const def of INTEGRATIONS) {
    const g = guideFor(def.id, ctx)!;
    assert.deepEqual(g.fields.map((f) => [f.key, f.label, f.required, f.secret]), def.fields.map((f) => [f.key, f.label, f.required, f.secret]));
    if (def.fields.length && !def.perClient) assert.match(g.enter.steps.map((s) => s.text).join(" "), new RegExp(`\\*\\*${def.name.replace(/[()]/g, "\\$&")}\\*\\*`), `${def.id}: names its card`);
  }
});

test("redirect URIs and addresses use this deployment's address; no placeholder is left unfilled", () => {
  const g = guideFor("google_oauth", ctx)!;
  const def = INTEGRATIONS.find((i) => i.id === "google_oauth")!;
  assert.ok(def.redirectPath);
  const uri = `${APP}${def.redirectPath}`;
  assert.ok(g.addresses.some((a) => a.value === uri), "redirect URI listed");
  assert.ok(JSON.stringify(g.parts).includes(uri), "redirect URI in the steps");
  assert.ok(guideFor("meta", ctx)!.addresses.every((a) => a.value.startsWith(`${APP}/api/platform-webhooks/meta/`)));
  for (const guide of [...allGuides(ctx), guideIntro(ctx)]) {
    const text = JSON.stringify(guide);
    assert.doesNotMatch(text, /\{(app|org|appUrl|appHost|redirectUri)\}/, "unfilled placeholder");
    assert.ok(!text.includes("SEO Insights") || ctx.appName === "SEO Insights", "the product name follows the organization's branding");
  }
  // defaults without a context
  assert.match(JSON.stringify(guideFor("google_oauth", { appUrl: "https://x.example" })!.addresses), /https:\/\/x\.example\/api\/integrations\/gbp\/callback/);
});

test("official links are https and guides contain no credential-looking values", () => {
  const SECRETS = [
    /sk-ant-[a-z0-9]{2,}-[A-Za-z0-9_-]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /GOCSPX-[A-Za-z0-9_-]{16,}/, /\bak_[A-Za-z0-9]{12,}/, /\bac_[A-Za-z0-9]{8,}/,
    /ssxmcp_[A-Za-z0-9]{8,}/, /\bEAA[A-Za-z0-9]{20,}/, /\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  ];
  for (const g of allGuides(ctx)) {
    for (const l of g.links) assert.match(l.url, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i, `${g.id}: ${l.url}`);
    const text = JSON.stringify(g);
    for (const re of SECRETS) assert.doesNotMatch(text, re, `${g.id} contains something that looks like a credential`);
    // nothing long and random outside URLs (a pasted key would be)
    const words = (text.replace(/https?:\/\/[^\s"'`)]+/g, "").match(/[A-Za-z0-9_+/=-]{40,}/g) ?? []).filter((w) => !/^[A-Z][A-Z0-9_]+$/.test(w)); // key names are fine
    assert.deepEqual(words, [], `${g.id}: long token-like strings`);
  }
});

test("guide text markup: bold, code and links", () => {
  assert.deepEqual(inlineTokens("Open **Settings → API keys** at https://example.com/keys). Copy `sk-ant-…`."), [
    { kind: "text", text: "Open " }, { kind: "strong", text: "Settings → API keys" }, { kind: "text", text: " at " },
    { kind: "link", text: "https://example.com/keys" }, { kind: "text", text: "). Copy " }, { kind: "code", text: "sk-ant-…" }, { kind: "text", text: "." },
  ]);
  assert.equal(inline("**A** → <b>"), "<b>A</b> › &lt;b&gt;");
  assert.equal(inline("see https://a.example/x?y=1&z=2."), `see <a href="https://a.example/x?y=1&amp;z=2">https://a.example/x?y=1&amp;z=2</a>.`);
  assert.equal(inline("`A_B` <i>"), "<code>A_<wbr>B</code> &lt;i&gt;");
});

test("the PDF document: cover, contents, every section, escaped organization name, statuses only", () => {
  const guides = allGuides(ctx);
  const status = Object.fromEntries(guides.map((g, i) => [g.id, i % 2 ? { state: "configured" as const, label: "Configured" } : { state: "missing" as const, label: "Not configured" }]));
  const input = {
    mode: "all" as const, guides, intro: guideIntro(ctx), status, generatedAt: new Date("2026-11-27T10:00:00Z"), timeZone: "America/New_York", appUrl: APP,
    brand: { appName: "Acme Insights", orgName: `Acme "Agency" </style><script>alert(1)</script>`, logo: null, color: "#123456" },
  };
  const entries = documentEntries(input);
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, "section ids are unique");
  assert.deepEqual(measuredBlocks(input), ["contents", ...entries.map((e) => e.id)]);
  const pages = Object.fromEntries(entries.map((e, i) => [e.id, 3 + i * 2]));
  const html = guideDocumentHtml({ ...input, pages });
  assert.doesNotMatch(html, /<script>/, "organization name is escaped");
  assert.equal(html.match(/<\/style>/g)?.length, 1, "the footer text can't end the style element");
  assert.match(html, /Acme &quot;Agency&quot;/);
  assert.match(html, new RegExp(`Version ${GUIDES_VERSION.replace(".", "\\.")}`));
  assert.match(html, /Updated November 27, 2026/);
  assert.match(html, /counter\(page\)/, "page numbers");
  for (const g of guides) {
    assert.ok(html.includes(`id="sec-${g.id}"`), `section ${g.id}`);
    assert.ok(html.includes(`href="#sec-${g.id}"`), `contents link ${g.id}`);
  }
  assert.ok(html.includes(`<span class="p">${pages["sec-anthropic"]}</span>`), "contents page numbers");
  assert.ok(html.includes("Not configured") && html.includes("Configured"));
  assert.match(html, /<a href="https:\/\/platform\.claude\.com\/settings\/keys">/, "clickable links");
  assert.doesNotMatch(html, /→|✓/, "only glyphs the server font has");
  // one integration: no cover or contents
  const single = guideDocumentHtml({ ...input, mode: "single", guides: [guideFor("bing", ctx)!], intro: undefined, status: { bing: status.bing } });
  assert.doesNotMatch(single, /class="cover"|id="contents"/);
  assert.match(single, /id="sec-bing"/);
  assert.equal(GUIDES_UPDATED.length, 10);
});

test("PDF page counting", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj <</Type /Pages /Count 2 /Kids [2 0 R 3 0 R]>> endobj\n2 0 obj <</Type /Page /Parent 1 0 R>> endobj\n3 0 obj <</Type/Page/Parent 1 0 R>> endobj\n", "latin1");
  assert.equal(countPdfPages(pdf), 2);
});
