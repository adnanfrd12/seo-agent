import { mix, shownColor, DEFAULT_BRAND_COLORS } from "@/lib/org/branding-theme";
import { GUIDES_UPDATED, GUIDES_VERSION, inlineTokens, type Guide, type GuidePart } from "@/lib/org/guides";

/**
 * The HTML that headless Chromium prints as the setup-guide PDFs: the complete guide (cover, contents, an
 * introduction with a status overview, one numbered section per integration, appendices) or one integration.
 * Pure string building, no browser or database, so it can be unit-tested. Every piece of text is escaped; the
 * only inputs are the guides (no values), the organization's name and public branding, and a status label per
 * integration ("Configured", "Not configured"…). Credential values never reach this module.
 *
 * Print notes: A4, page numbers in the page margin (CSS margin boxes), each section starts on a new page, links
 * stay clickable in the PDF. Glyphs are limited to what the server's only font (Open Sans) has: no arrows or
 * check marks as characters ("→" is printed as "›", boxes are drawn with CSS).
 */
export type GuideState = "configured" | "partial" | "missing" | "connected" | "not_connected";
export interface GuideStatus { state: GuideState; label: string }

export interface GuideBrand {
  /** product name shown on the cover (white-label name, else SEO Insights) */
  appName: string;
  orgName: string;
  /** logo as a data: URI (fetched by the caller), or null for a monogram */
  logo: string | null;
  /** brand colour (#rrggbb); defaults to the SEO Insights accent */
  color: string | null;
}

export interface GuideDocInput {
  mode: "all" | "single";
  guides: Guide[];
  intro?: { title: string; summary: string; groups: { title: string; items: string[]; ordered?: boolean }[] };
  brand: GuideBrand;
  status: Record<string, GuideStatus>;
  generatedAt: Date;
  timeZone?: string;
  appUrl: string;
  /** section id → first page, from a measuring pass (complete guide only) */
  pages?: Record<string, number>;
}

/* ------------------------------------------------------------------------------------------------ text */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
/** characters the PDF font can draw (and no control characters) */
const printable = (s: string) => s.replace(/\s*→\s*/g, " › ").replace(/✓/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
/** a CSS string literal that can't end the string or the style element */
const cssString = (s: string) => `"${printable(s).replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/</g, "\\3C ").replace(/>/g, "\\3E ")}"`;

/** escaped, with line-break opportunities after / _ . (keys, URLs and scopes break there, not mid-word) */
export const breakable = (s: string) => esc(s).replace(/([/_.])/g, "$1<wbr>");

/** guide text with **bold**, `code` and links */
export function inline(text: string): string {
  return inlineTokens(printable(text)).map((t) => {
    if (t.kind === "strong") return `<b>${esc(t.text)}</b>`;
    if (t.kind === "code") return `<code>${breakable(t.text)}</code>`;
    if (t.kind === "link") return `<a href="${esc(t.text)}">${esc(t.text)}</a>`;
    return esc(t.text);
  }).join("");
}

const longDate = (d: Date, timeZone?: string) => {
  try { return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: timeZone || "UTC" }).format(d); }
  catch { return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(d); }
};
export const updatedLabel = () => longDate(new Date(`${GUIDES_UPDATED}T12:00:00Z`), "UTC");

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/;
const HEX = /^#[0-9a-f]{6}$/i;

function monogram(name: string) {
  const letters = name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "");
  return letters.join("").toUpperCase() || "S";
}

/* ----------------------------------------------------------------------------------------------- model */

interface Entry { id: string; num: string; title: string; kind: "intro" | "guide" | "appendix"; guide?: Guide }

/** The sections of a document, in order (shared by the contents page and the body, so ids always match). */
export function documentEntries(input: Pick<GuideDocInput, "mode" | "guides" | "intro">): Entry[] {
  if (input.mode === "single") return input.guides.map((g) => ({ id: `sec-${g.id}`, num: "", title: g.name, kind: "guide" as const, guide: g }));
  const out: Entry[] = [];
  let n = 0;
  if (input.intro) out.push({ id: "sec-intro", num: String(++n), title: input.intro.title, kind: "intro" });
  for (const g of input.guides) out.push({ id: `sec-${g.id}`, num: String(++n), title: g.name, kind: "guide", guide: g });
  out.push({ id: "sec-fields", num: "A", title: "Field reference", kind: "appendix" });
  out.push({ id: "sec-addresses", num: "B", title: "Addresses to copy", kind: "appendix" });
  return out;
}

/* ------------------------------------------------------------------------------------------------- css */

function css(input: GuideDocInput, footer: string): string {
  const base = input.brand.color && HEX.test(input.brand.color) ? input.brand.color : DEFAULT_BRAND_COLORS.primary;
  const accent = shownColor("primary", base).light;
  const soft = mix(accent, "#ffffff", 0.9);
  const first = input.mode === "all"
    ? "@page :first { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }"
    : "";
  return `
@page { size: A4; margin: 16mm 15mm 18mm;
  @bottom-left { content: ${cssString(footer)}; font: 7.5pt "Segoe UI", "Open Sans", Arial, sans-serif; color: #8a8a93; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt "Segoe UI", "Open Sans", Arial, sans-serif; color: #8a8a93; } }
${first}
:root { --ink: #17171a; --secondary: #4f4f58; --muted: #6e6e77; --line: #e6e5e1; --soft: #f5f4f1; --accent: ${accent}; --accent-soft: ${soft};
  --pos: #0f7a55; --pos-soft: #eaf4ef; --warn: #a86a12; --warn-soft: #f8f0e2; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html { font-family: "Segoe UI", "Open Sans", "Helvetica Neue", Arial, sans-serif; font-size: 9.4pt; line-height: 1.5; color: var(--ink); }
body { margin: 0; }
h1, h2, h3, h4 { margin: 0; line-height: 1.25; break-after: avoid; }
p { margin: 0 0 6px; }
a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 0.5pt; text-underline-offset: 1.5pt; overflow-wrap: anywhere; }
code { font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace; font-size: 8.4pt; background: var(--soft); border: 0.5pt solid var(--line); border-radius: 3px; padding: 0 3px; overflow-wrap: anywhere; }
b { font-weight: 600; }
ul, ol { margin: 4px 0 8px; padding-left: 16px; }
li { margin: 2px 0; }
li::marker { color: var(--muted); }
.muted { color: var(--muted); }
.avoid { break-inside: avoid; }

/* cover */
.cover { height: 296mm; padding: 24mm 20mm 20mm; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; break-after: page;
  background: linear-gradient(165deg, #ffffff 0%, #ffffff 58%, var(--accent-soft) 100%); }
.cover::before { content: ""; position: absolute; right: -55mm; top: -55mm; width: 150mm; height: 150mm; border-radius: 50%; background: var(--accent-soft); }
.cover > * { position: relative; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand img { max-height: 16mm; max-width: 70mm; object-fit: contain; }
.mono { width: 13mm; height: 13mm; border-radius: 3mm; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 14pt; }
.brand-name { font-size: 15pt; font-weight: 700; }
.brand-sub { font-size: 8.5pt; color: var(--muted); }
.kicker { font-size: 8.5pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); }
.cover h1 { font-size: 31pt; font-weight: 800; letter-spacing: -0.015em; margin-top: 8px; max-width: 150mm; }
.lede { font-size: 12pt; color: var(--secondary); margin-top: 12px; max-width: 140mm; }
.cover-stats { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.stat { border: 0.75pt solid var(--line); background: #fff; border-radius: 999px; padding: 4px 12px; font-size: 9pt; }
.stat b { color: var(--accent); }
.cover-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.meta { border-top: 1.5pt solid var(--ink); padding-top: 6px; font-size: 8.5pt; color: var(--muted); overflow-wrap: anywhere; }
.meta b { display: block; color: var(--ink); font-size: 9.5pt; margin-bottom: 1px; }

/* contents */
.toc { break-before: page; }
.toc h2, .part-title { font-size: 19pt; font-weight: 800; letter-spacing: -0.01em; padding-bottom: 8px; border-bottom: 1.5pt solid var(--ink); margin-bottom: 10px; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0; break-inside: avoid; }
.toc a { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; color: var(--ink); text-decoration: none; border-bottom: 0.5pt solid var(--line); }
.toc .n { width: 8mm; font-weight: 700; color: var(--accent); }
.toc .t { font-weight: 600; }
.toc .c { color: var(--muted); font-size: 8pt; }
.toc .dots { flex: 1; border-bottom: 0.75pt dotted #b9bcc6; transform: translateY(-3px); }
.toc .p { min-width: 8mm; text-align: right; font-variant-numeric: tabular-nums; color: var(--secondary); }

/* sections */
.part { break-before: page; }
.single-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; margin-bottom: 12px; border-bottom: 0.75pt solid var(--line); }
.single-head .brand img { max-height: 10mm; max-width: 50mm; }
.single-head .mono { width: 9mm; height: 9mm; font-size: 10pt; border-radius: 2mm; }
.single-head .brand-name { font-size: 11pt; }
.single-meta { text-align: right; font-size: 8pt; color: var(--muted); }
.part-head { display: flex; align-items: flex-end; gap: 12px; padding-bottom: 10px; border-bottom: 1.5pt solid var(--ink); margin-bottom: 10px; }
.part-num { font-size: 36pt; font-weight: 800; line-height: .85; color: var(--accent); }
.eyebrow { font-size: 7.5pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 3px; }
.part-head h2 { font-size: 19pt; font-weight: 800; letter-spacing: -0.01em; }
.part-head p { color: var(--secondary); margin: 3px 0 0; }
h3 { font-size: 11.5pt; font-weight: 700; margin: 14px 0 6px; }
h4 { font-size: 10pt; font-weight: 700; margin: 10px 0 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 10px; }
.chip { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 7.8pt; font-weight: 600; background: var(--soft); color: var(--secondary); border: 0.5pt solid var(--line); }
.chip.ok { background: var(--pos-soft); color: var(--pos); border-color: transparent; }
.chip.partial { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.grid2 { display: grid; grid-template-columns: 1.35fr 1fr; gap: 10px; }
.box { border: 0.75pt solid var(--line); border-radius: 8px; padding: 9px 11px; break-inside: avoid; }
.box h4 { margin-top: 0; }
.box p:last-child { margin-bottom: 0; }
dl.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; }
dl.kv dt { color: var(--muted); }
dl.kv dd { margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; padding: 0; margin: 4px 0 8px; }
.tags li { margin: 0; border: 0.5pt solid var(--line); border-radius: 4px; padding: 1px 6px; font-size: 8.3pt; }
.group { margin: 8px 0 10px; break-inside: avoid-page; }
.group-title { display: flex; align-items: center; gap: 7px; font-size: 10.2pt; font-weight: 700; margin: 10px 0 4px; break-after: avoid; }
.letter { display: inline-grid; place-items: center; width: 5.2mm; height: 5.2mm; border-radius: 50%; background: var(--ink); color: #fff; font-size: 7.8pt; font-weight: 700; }
.intro { color: var(--secondary); }
ol.steps { list-style: none; counter-reset: step; padding: 0; margin: 4px 0 6px; }
ol.steps > li { counter-increment: step; position: relative; padding: 0 0 5px 25px; margin: 0; break-inside: avoid; }
ol.steps > li::before { content: counter(step); position: absolute; left: 0; top: 0.5pt; width: 14pt; height: 14pt; border-radius: 50%; border: 0.75pt solid var(--accent); color: var(--accent); font-size: 7.5pt; font-weight: 700; display: grid; place-items: center; }
ol.steps ul { margin: 3px 0 2px; }
.note { border-left: 2pt solid var(--accent); background: var(--accent-soft); padding: 5px 9px; border-radius: 0 6px 6px 0; margin: 4px 0 8px; break-inside: avoid; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 8.6pt; }
thead { display: table-header-group; }
th { text-align: left; font-size: 7.2pt; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; border-bottom: 1pt solid var(--ink); padding: 4px 6px; }
td { border-bottom: 0.5pt solid var(--line); padding: 5px 6px; vertical-align: top; overflow-wrap: anywhere; }
tr { break-inside: avoid; }
td.k { font-weight: 600; }
.addr { border: 0.75pt solid var(--line); border-radius: 6px; padding: 6px 9px; margin: 4px 0; break-inside: avoid; }
.addr .v { font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace; font-size: 8.6pt; overflow-wrap: anywhere; display: block; margin-top: 2px; }
.checklist { list-style: none; padding: 0; margin: 4px 0 8px; }
.checklist li { position: relative; padding: 3px 0 3px 20px; border-bottom: 0.5pt dashed var(--line); margin: 0; break-inside: avoid; }
.checklist li::before { content: ""; position: absolute; left: 1px; top: 5px; width: 10pt; height: 10pt; border: 1pt solid var(--ink); border-radius: 2px; }
.links li { margin: 3px 0; }
.links a { display: block; font-size: 8.2pt; }
.fields td:first-child { width: 24%; } .fields td:nth-child(2) { width: 27%; } .fields td:nth-child(3) { width: 9%; }
.verify { margin-top: 12px; font-size: 8pt; color: var(--muted); border-top: 0.5pt solid var(--line); padding-top: 6px; break-inside: avoid; }
.status-table td:last-child { white-space: nowrap; }
`;
}

/* ----------------------------------------------------------------------------------------------- parts */

const stateClass = (s?: GuideStatus) => (s?.state === "configured" || s?.state === "connected" ? "ok" : s?.state === "partial" ? "partial" : "");
const chip = (text: string, cls = "") => `<span class="chip ${cls}">${esc(printable(text))}</span>`;
const scopeLabel = (g: Guide) => (g.scope === "client" ? "Connected per client" : g.scope === "settings" ? "Organization settings" : "Organization credential");

function brandBlock(b: GuideBrand): string {
  const logo = b.logo && DATA_IMAGE.test(b.logo) ? `<img src="${esc(b.logo)}" alt="">` : `<div class="mono">${esc(monogram(b.appName))}</div>`;
  return `<div class="brand">${logo}<div><div class="brand-name">${esc(printable(b.appName))}</div><div class="brand-sub">${esc(printable(b.orgName))}</div></div></div>`;
}

function stepsHtml(part: GuidePart, letter?: string): string {
  const title = part.title ? `<div class="group-title">${letter ? `<span class="letter">${letter}</span>` : ""}${inline(part.title)}</div>` : "";
  const steps = part.steps.map((s) => `<li>${inline(s.text)}${s.sub?.length ? `<ul>${s.sub.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>` : ""}</li>`).join("");
  return `<div class="group">${title}${part.intro ? `<p class="intro">${inline(part.intro)}</p>` : ""}${steps ? `<ol class="steps">${steps}</ol>` : ""}${part.note ? `<div class="note">${inline(part.note)}</div>` : ""}</div>`;
}

const list = (items: string[], cls = "") => (items.length ? `<ul${cls ? ` class="${cls}"` : ""}>${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>` : "");

function guideBody(g: Guide, input: GuideDocInput, appName: string): string {
  const st = input.status[g.id];
  const out: string[] = [];
  const chips = [
    st ? chip(st.label, stateClass(st)) : "",
    chip(scopeLabel(g)),
    g.testable ? chip("Test connection available") : "",
  ].filter(Boolean).join("");
  out.push(`<div class="chips">${chips}</div>`);
  out.push(`<div class="grid2"><div class="box"><h4>What it's for</h4><p>${inline(g.purpose)}</p></div><div class="box"><h4>At a glance</h4><dl class="kv"><dt>Cost</dt><dd>${inline(g.cost)}</dd><dt>Time</dt><dd>${inline(g.time)}</dd><dt>Set up</dt><dd>${esc(scopeLabel(g))}</dd></dl></div></div>`);
  if (g.features.length) out.push(`<h3>Features that depend on it</h3><ul class="tags">${g.features.map((f) => `<li>${esc(printable(f))}</li>`).join("")}</ul>`);
  if (g.requirements.length) out.push(`<h3>Before you start</h3>${list(g.requirements)}`);
  if (g.parts.length) {
    out.push(`<h3>Step by step</h3>`);
    g.parts.forEach((p, i) => out.push(stepsHtml(p, String.fromCharCode(65 + i))));
  }
  if (g.apis.length) out.push(`<h3>APIs to enable</h3>${list(g.apis.map((a) => `**${a}**`))}`);
  if (g.scopes.length) {
    out.push(`<h3>Permissions (OAuth scopes)</h3><table><thead><tr><th>Scope</th><th>Why</th></tr></thead><tbody>${g.scopes.map((s) => `<tr><td><code>${breakable(s.scope)}</code></td><td>${inline(s.why)}</td></tr>`).join("")}</tbody></table>`);
  }
  if (g.consent.length) out.push(`<h3>Consent screen</h3>${list(g.consent)}`);
  if (g.addresses.length) {
    out.push(`<h3>Addresses to copy</h3>${g.addresses.map((a) => `<div class="addr"><b>${esc(printable(a.label))}</b>${a.note ? ` <span class="muted">${inline(a.note)}</span>` : ""}<span class="v">${breakable(a.value)}</span></div>`).join("")}`);
  }
  out.push(`<h3>${inline(g.enter.title)}</h3>`);
  out.push(stepsHtml({ ...g.enter, title: "" }));
  if (g.fields.length) {
    out.push(`<table class="fields"><thead><tr><th>Field in ${esc(printable(appName))}</th><th>Key</th><th>Required</th><th>Where to find it</th></tr></thead><tbody>${g.fields.map((f) =>
      `<tr><td class="k">${esc(printable(f.label))}${f.secret ? ` <span class="muted">(secret)</span>` : ""}</td><td><code>${breakable(f.key)}</code></td><td>${f.required ? "Yes" : "Optional"}</td><td>${inline(f.source)}</td></tr>`).join("")}</tbody></table>`);
  }
  if (g.test.length) out.push(`<h3>Test the connection</h3>${list(g.test)}`);
  if (g.problems.length) {
    out.push(`<h3>Troubleshooting</h3><table><thead><tr><th style="width:42%">Problem</th><th>Fix</th></tr></thead><tbody>${g.problems.map((p) => `<tr><td class="k">${inline(p.problem)}</td><td>${inline(p.fix)}</td></tr>`).join("")}</tbody></table>`);
  }
  if (g.renewal.length) out.push(`<h3>Expiry and renewal</h3>${list(g.renewal)}`);
  if (g.checklist.length) out.push(`<h3>Checklist</h3>${list(g.checklist, "checklist")}`);
  if (g.links.length) out.push(`<h3>Official links</h3><ul class="links">${g.links.map((l) => `<li><b>${esc(printable(l.label))}</b><a href="${esc(l.url)}">${esc(l.url)}</a></li>`).join("")}</ul>`);
  const checked = `Checked against the providers' official documentation on ${esc(updatedLabel())}.`;
  out.push(`<p class="verify">${checked}${g.unverified.length ? ` Not confirmed there: ${g.unverified.map((u) => inline(u)).join(" ")}` : ""} Screens change from time to time; if a label differs, look for the closest match.</p>`);
  return out.join("\n");
}

function guideSection(e: Entry, input: GuideDocInput): string {
  const g = e.guide!;
  const head = input.mode === "single"
    ? `<div class="single-head">${brandBlock(input.brand)}<div class="single-meta">Setup guide · version ${esc(GUIDES_VERSION)}<br>Updated ${esc(updatedLabel())}</div></div>`
    : "";
  return `<section class="part" id="${e.id}">${head}<header class="part-head">${e.num ? `<div class="part-num">${esc(e.num)}</div>` : ""}<div><div class="eyebrow">${esc(g.categoryLabel)} · ${esc(scopeLabel(g))}</div><h2>${esc(printable(g.name))}</h2><p>${inline(g.description)}</p></div></header>${guideBody(g, input, input.brand.appName)}</section>`;
}

function introSection(e: Entry, input: GuideDocInput): string {
  const intro = input.intro!;
  const groups = intro.groups.map((gr) => `<div class="box avoid" style="margin-bottom:8px"><h4>${inline(gr.title)}</h4>${gr.ordered ? `<ol>${gr.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ol>` : list(gr.items)}</div>`).join("");
  const rows = input.guides.map((g, i) => {
    const st = input.status[g.id];
    return `<tr><td>${i + 2}</td><td class="k"><a href="#sec-${g.id}" style="color:inherit;text-decoration:none">${esc(printable(g.name))}</a></td><td>${esc(scopeLabel(g))}</td><td>${st ? chip(st.label, stateClass(st)) : ""}</td></tr>`;
  }).join("");
  return `<section class="part" id="${e.id}"><header class="part-head"><div class="part-num">${esc(e.num)}</div><div><div class="eyebrow">Read this first</div><h2>${esc(intro.title)}</h2></div></header>
<p>${inline(intro.summary)}</p>
<p class="muted">This deployment's address: <code>${breakable(input.appUrl)}</code>. The guide shows no credential values, only whether each integration is set up (status on ${esc(longDate(input.generatedAt, input.timeZone))}).</p>
${groups}
<h3>Status overview</h3>
<table class="status-table"><thead><tr><th>#</th><th>Integration</th><th>Set up</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function fieldsAppendix(e: Entry, input: GuideDocInput): string {
  const rows = input.guides.flatMap((g) => g.fields.map((f) =>
    `<tr><td>${esc(printable(g.name))}</td><td class="k">${esc(printable(f.label))}</td><td><code>${breakable(f.key)}</code></td><td>${f.required ? "Yes" : "Optional"}</td><td>${f.secret ? "Yes" : "No"}</td></tr>`)).join("");
  return `<section class="part" id="${e.id}"><header class="part-head"><div class="part-num">${esc(e.num)}</div><div><div class="eyebrow">Appendix</div><h2>${esc(e.title)}</h2><p>Every organization credential, as labelled in ${esc(printable(input.brand.appName))}. Secrets are encrypted and never shown again after saving.</p></div></header>
<table><thead><tr><th>Integration</th><th>Field</th><th>Key</th><th>Required</th><th>Secret</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function addressesAppendix(e: Entry, input: GuideDocInput): string {
  const seen = new Set<string>();
  const rows = input.guides.flatMap((g) => g.addresses.map((a) => ({ g, a }))).filter(({ a }) => {
    if (seen.has(a.value)) return false;
    seen.add(a.value);
    return true;
  }).map(({ g, a }) => `<tr><td>${esc(printable(g.name))}</td><td class="k">${esc(printable(a.label))}</td><td><code>${breakable(a.value)}</code></td></tr>`).join("");
  return `<section class="part" id="${e.id}"><header class="part-head"><div class="part-num">${esc(e.num)}</div><div><div class="eyebrow">Appendix</div><h2>${esc(e.title)}</h2><p>Redirect and callback addresses to paste into other services' consoles. They must match exactly.</p></div></header>
<table><thead><tr><th>Integration</th><th>What</th><th>Address</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function contents(entries: Entry[], input: GuideDocInput): string {
  const numbered = Boolean(input.pages);
  return `<section class="toc" id="contents"><h2>Contents</h2><ol>${entries.map((e) => {
    const page = input.pages?.[e.id];
    const sub = e.guide ? `<span class="c">${esc(e.guide.categoryLabel)}</span>` : e.kind === "appendix" ? `<span class="c">Appendix</span>` : "";
    return `<li><a href="#${e.id}"><span class="n">${esc(e.num)}</span><span class="t">${esc(printable(e.title))}</span>${sub}<span class="dots"></span><span class="p">${numbered ? esc(String(page ?? "")) : ""}</span></a></li>`;
  }).join("")}</ol></section>`;
}

function cover(input: GuideDocInput): string {
  const states = Object.values(input.status);
  const done = states.filter((s) => s.state === "configured" || s.state === "connected").length;
  const app = esc(printable(input.brand.appName));
  return `<section class="cover">
<div>${brandBlock(input.brand)}</div>
<div><div class="kicker">Integration setup guide</div>
<h1>Connect every service ${app} uses</h1>
<p class="lede">Step-by-step instructions to create each account, get each credential and enter it in ${app}. Written for the owners of ${esc(printable(input.brand.orgName))}; no technical knowledge needed.</p>
<div class="cover-stats"><span class="stat"><b>${input.guides.length}</b> integrations</span>${states.length ? `<span class="stat"><b>${done}</b> set up</span><span class="stat"><b>${states.length - done}</b> to do or optional</span>` : ""}</div></div>
<div class="cover-meta"><div class="meta"><b>Organization</b>${esc(printable(input.brand.orgName))}</div><div class="meta"><b>Version ${esc(GUIDES_VERSION)}</b>Updated ${esc(updatedLabel())}</div><div class="meta"><b>Generated</b>${esc(longDate(input.generatedAt, input.timeZone))}</div></div>
</section>`;
}

function bodyOf(e: Entry, input: GuideDocInput): string {
  if (e.kind === "intro") return introSection(e, input);
  if (e.kind === "guide") return guideSection(e, input);
  return e.id === "sec-fields" ? fieldsAppendix(e, input) : addressesAppendix(e, input);
}

/**
 * The complete HTML document. `only` renders a single block ("contents" or a section id) after a blank first page:
 * the measuring pass prints each block alone to learn how many pages it takes (for the page numbers in Contents).
 */
export function guideDocumentHtml(input: GuideDocInput, only?: string): string {
  const entries = documentEntries(input);
  const title = input.mode === "all" ? "Integration setup guide" : `${input.guides[0]?.name ?? "Integration"} setup guide`;
  const footer = `${input.brand.orgName} · ${title} · v${GUIDES_VERSION}`;
  let body: string;
  if (only) {
    const block = only === "contents" ? contents(entries, { ...input, pages: Object.fromEntries(entries.map((e) => [e.id, 88])) }) : bodyOf(entries.find((e) => e.id === only)!, input);
    body = `<div style="height:10mm;break-after:page"></div>${block}`;
  } else {
    body = input.mode === "all"
      ? [cover(input), contents(entries, input), ...entries.map((e) => bodyOf(e, input))].join("\n")
      : entries.map((e) => bodyOf(e, input)).join("\n").replace(/^<section class="part"/, `<section class="part" style="break-before:auto"`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(printable(`${title} · ${input.brand.orgName}`))}</title><style>${css(input, footer)}</style></head><body>${body}</body></html>`;
}

/** Ids of the blocks a measuring pass prints (contents first). */
export const measuredBlocks = (input: GuideDocInput) => ["contents", ...documentEntries(input).map((e) => e.id)];
