import "server-only";
import type { TrackingFinding } from "./types";

/**
 * Reads the main pages of the website (home, plus contact / estimate / quote / book pages linked from it)
 * and lists the lead actions a visitor can take there: phone, email and text links, map links, forms
 * (including embedded GoHighLevel, HubSpot, Jotform… forms), chat widgets and booking links.
 */
const UA = "Mozilla/5.0 (compatible; SEO-Insights-dashboard/1.0)";

async function get(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
    return (await r.text()).slice(0, 3_000_000);
  } catch { return null; }
}

const uniq = (xs: string[]) => [...new Set(xs)];

export async function crawlLeadActions(site: string): Promise<{ pages: string[]; findings: TrackingFinding[]; error?: string }> {
  let base: URL;
  try { base = new URL(site.startsWith("http") ? site : `https://${site}`); } catch { return { pages: [], findings: [], error: "No website address." }; }
  const home = await get(base.origin + "/");
  if (!home) return { pages: [], findings: [], error: `Couldn't open ${base.origin}.` };
  const hrefs = [...home.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const extra = uniq(hrefs.map((h) => { try { return new URL(h, base.origin); } catch { return null; } })
    .filter((u): u is URL => !!u && u.origin === base.origin && /contact|estimate|quote|book|schedule|appointment|request/i.test(u.pathname))
    .map((u) => u.origin + u.pathname)).slice(0, 4);
  const pages = [{ url: base.origin + "/", html: home }];
  for (const u of extra) { const h = await get(u); if (h) pages.push({ url: u, html: h }); }

  const acc = new Map<string, TrackingFinding>();
  const add = (kind: TrackingFinding["kind"], action: string, item: string, page: string) => {
    const f = acc.get(action) ?? { action, kind, found: [], pages: [] };
    if (!f.found.includes(item)) f.found.push(item);
    const path = new URL(page).pathname;
    if (!f.pages.includes(path)) f.pages.push(path);
    acc.set(action, f);
  };
  for (const { url, html } of pages) {
    for (const m of html.matchAll(/href\s*=\s*["'](tel:[^"']+)["']/gi)) add("call", "Phone links (tel:)", decodeURIComponent(m[1]).replace(/\s+/g, ""), url);
    for (const m of html.matchAll(/href\s*=\s*["'](mailto:[^"'?]+)/gi)) add("email", "Email links (mailto:)", m[1], url);
    for (const m of html.matchAll(/href\s*=\s*["'](sms:[^"']+)["']/gi)) add("sms", "Text / SMS links (sms:)", m[1], url);
    for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps[^"']*|maps\.google\.[a-z.]+[^"']*|maps\.app\.goo\.gl[^"']*|goo\.gl\/maps[^"']*|maps\.apple\.com[^"']*))["']/gi)) add("directions", "Direction links (Google Maps)", m[1].slice(0, 80), url);
    const forms = (html.match(/<form\b/gi) ?? []).length;
    if (forms) add("form", "Forms", `${forms} form${forms > 1 ? "s" : ""} on ${new URL(url).pathname}`, url);
    for (const [re, name] of [[/leadconnectorhq\.com\/widget\/form|msgsndr\.com|link\.msgsndr/i, "GoHighLevel form"], [/hsforms\.(net|com)|hbspt\.forms/i, "HubSpot form"], [/jotform\.com/i, "Jotform"], [/typeform\.com/i, "Typeform"], [/docs\.google\.com\/forms/i, "Google Form"], [/wpforms|gravityforms|gform_|wpcf7|elementor-form|ninja-forms/i, "WordPress form"]] as const) {
      if (re.test(html)) add("form", "Forms", name, url);
    }
    for (const [re, name] of [[/leadconnectorhq\.com\/.*chat|chat-widget|widgets\.leadconnectorhq/i, "GoHighLevel chat"], [/tawk\.to/i, "Tawk.to"], [/intercom/i, "Intercom"], [/drift\.com|js\.driftt/i, "Drift"], [/livechatinc/i, "LiveChat"], [/crisp\.chat/i, "Crisp"], [/tidio/i, "Tidio"], [/facebook\.com\/plugins\/customerchat|m\.me\//i, "Messenger"], [/wa\.me\/|api\.whatsapp\.com/i, "WhatsApp"]] as const) {
      if (re.test(html)) add("chat", "Chat widget", name, url);
    }
    for (const [re, name] of [[/calendly\.com/i, "Calendly"], [/acuityscheduling/i, "Acuity"], [/leadconnectorhq\.com\/widget\/booking|\/widget\/bookings/i, "GoHighLevel booking"], [/booksy|squareup\.com\/appointments|setmore|housecallpro|jobber/i, "Booking link"]] as const) {
      if (re.test(html)) add("booking", "Booking links", name, url);
    }
  }
  return { pages: pages.map((p) => new URL(p.url).pathname), findings: [...acc.values()] };
}
