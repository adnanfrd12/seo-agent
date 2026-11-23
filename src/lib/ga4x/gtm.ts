/**
 * An import-ready Google Tag Manager container (Admin → Import container → Merge) that sends a GA4 event
 * for each lead action found on the site that GA4 doesn't receive yet. Existing event names are reused so
 * nothing is counted twice.
 */
export interface GapTag { event: string; kind: "call" | "email" | "sms" | "directions" | "form"; match: string }

const v = (key: string, value: string) => ({ type: "TEMPLATE", key, value });
const params = (rows: [string, string][]) => ({ type: "LIST", key: "eventSettingsTable", list: rows.map(([k, val]) => ({ type: "MAP", map: [v("parameter", k), v("parameterValue", val)] })) });

export function gtmContainer(measurementId: string | null, gaps: GapTag[]): string {
  const trigger = gaps.map((g, i) => g.kind === "form"
    ? { triggerId: String(100 + i), name: `Lead · ${g.event}`, type: "FORM_SUBMISSION", waitForTags: { type: "BOOLEAN", value: "false" }, checkValidation: { type: "BOOLEAN", value: "true" } }
    : {
      triggerId: String(100 + i), name: `Lead · ${g.event}`, type: "LINK_CLICK", waitForTags: { type: "BOOLEAN", value: "false" }, checkValidation: { type: "BOOLEAN", value: "false" },
      filter: [{ type: g.kind === "directions" ? "MATCH_REGEX" : "STARTS_WITH", parameter: [v("arg0", "{{Click URL}}"), v("arg1", g.match)] }],
    });
  const tag = gaps.map((g, i) => ({
    tagId: String(200 + i), name: `GA4 event · ${g.event}`, type: "gaawe",
    parameter: [
      v("eventName", g.event),
      { type: "TEMPLATE", key: "measurementIdOverride", value: measurementId ?? "G-XXXXXXXXXX" },
      params(g.kind === "form" ? [["form_id", "{{Form ID}}"], ["page_location", "{{Page URL}}"]] : [["link_url", "{{Click URL}}"], ["link_text", "{{Click Text}}"], ["page_location", "{{Page URL}}"]]),
    ],
    firingTriggerId: [String(100 + i)], tagFiringOption: "ONCE_PER_EVENT",
  }));
  const builtInVariable = ["CLICK_URL", "CLICK_TEXT", "PAGE_URL", "FORM_ID"].map((type) => ({ type, name: type.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ") }));
  return JSON.stringify({ exportFormatVersion: 2, exportTime: new Date().toISOString().replace("T", " ").slice(0, 19), containerVersion: { tag, trigger, builtInVariable } }, null, 2);
}

/** The same events as a gtag.js snippet, for sites without Tag Manager. */
export function gtagSnippet(gaps: GapTag[]): string {
  const lines = gaps.filter((g) => g.kind !== "form").map((g) => g.kind === "directions"
    ? `  if (/${g.match}/.test(a.href)) gtag('event', '${g.event}', { link_url: a.href, link_text: a.innerText.trim(), page_location: location.href });`
    : `  if (a.href.startsWith('${g.match}')) gtag('event', '${g.event}', { link_url: a.href, link_text: a.innerText.trim(), page_location: location.href });`);
  const form = gaps.find((g) => g.kind === "form");
  return `<script>\ndocument.addEventListener('click', function (e) {\n  var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;\n${lines.join("\n")}\n});${form ? `\ndocument.addEventListener('submit', function (e) { gtag('event', '${form.event}', { form_id: e.target.id || '', page_location: location.href }); });` : ""}\n</script>`;
}
