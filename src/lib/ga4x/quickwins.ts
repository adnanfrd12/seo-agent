/**
 * Lead quick wins: fixed rules over the last 30 days of GA4 data (qualified leads) that name a page, the
 * place on it, the evidence, the steps and the extra leads a month it should bring. Score = gain ×
 * confidence weight ÷ effort weight; the list is ranked by score.
 */
import type { G } from "./g";
import { group, isBlog, sum } from "./model";

export type QwType = "Landing page CTA" | "Blog CTA" | "Mobile call button" | "Form fix" | "Tracking gap" | "AI assistant traffic" | "Local proof" | "Answer every call" | "Ads budget" | "Data quality" | "Promote a winner" | "Engagement fix";
export interface QuickWin {
  key: string; type: QwType; title: string; page: string; where: string; why: string; evidence?: [string, string][]; steps: string[]; suggest?: string; measure?: string;
  gain: number; effort: "Low" | "Medium" | "High"; conf: "High" | "Medium" | "Low"; score: number; rank: number;
}

const P = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;
const N = (v: number) => Math.round(v).toLocaleString("en-US");
const DUR = (s: number) => { s = Math.round(s); const m = Math.floor(s / 60); return `${m ? `${m}m ` : ""}${s % 60}s`; };
const EFF = { Low: 1, Medium: 2, High: 3 } as const;
const CONF = { High: 1, Medium: 0.75, Low: 0.5 } as const;

/** Which quick-win types belong on which screen (the bottom task list). */
export const SCREEN_TYPES: Record<string, QwType[] | "*"> = {
  home: "*",
  leads: ["Landing page CTA", "Blog CTA", "Mobile call button", "Form fix", "Local proof", "Promote a winner", "Answer every call", "AI assistant traffic"],
  explorer: ["Landing page CTA", "Blog CTA", "Promote a winner", "AI assistant traffic", "Local proof"],
  leadlog: ["Answer every call", "Form fix", "Mobile call button"],
  setup: ["Tracking gap", "Data quality"],
  acq: ["AI assistant traffic", "Ads budget", "Landing page CTA", "Data quality"],
  eng: ["Landing page CTA", "Blog CTA", "Promote a winner", "Engagement fix"],
  geo: ["Local proof"],
  tech: ["Mobile call button", "Form fix"],
  ecom: [],
  funnels: ["Form fix", "Landing page CTA"],
  realtime: ["Answer every call"],
  quality: ["Data quality", "Tracking gap"],
  seo: ["Blog CTA", "Landing page CTA", "AI assistant traffic"],
};
export const forScreen = (all: QuickWin[], screen: string) => { const t = SCREEN_TYPES[screen]; return t === "*" ? all : all.filter((w) => (t ?? []).includes(w.type)); };

/** `g` must cover the last 30 days. */
export function quickWins(g: G): QuickWin[] {
  const out: Omit<QuickWin, "score" | "rank">[] = [];
  const add = (w: Omit<QuickWin, "score" | "rank">) => { if (!(w.gain > 0)) return; w.gain = Math.max(0.1, Math.round(w.gain * 10) / 10); out.push(w); };
  const T = g.total(), lr = T.lr;
  const lp = g.by((x) => String(x.land));
  const site = g.meta.streamUrl ?? "the website";

  // 1. landing pages with traffic but a low lead rate
  for (const p of lp.filter((r) => r.sessions >= 40 && r.lr < lr * 0.6 && !isBlog(r.key))) add({
    key: `lp${p.key}`, type: "Landing page CTA", page: p.key, where: "Top of the page (first screen on mobile)", effort: "Low", conf: "High", gain: p.sessions * (lr * 0.7 - p.lr),
    title: `Add a call button and estimate button to the first screen of ${p.key}`, why: `${N(p.sessions)} sessions a month but a lead rate of ${P(p.lr)} vs ${P(lr)} site-wide.`,
    evidence: [["Sessions (30d)", N(p.sessions)], ["Leads", N(p.leads)], ["Lead rate", P(p.lr)], ["Engagement rate", P(p.er)]],
    steps: ["Put a tap-to-call button and a 'Get an estimate' button above the fold.", "Repeat the call to action after each main section.", "Show 2–3 trust signals next to the button (reviews, certifications, years in business).", "Track both buttons as lead events (phone click and estimate form)."],
    suggest: "Above the fold: [Call [phone number]]  [Get an estimate]\nUnder it: ★ Reviews · [certification] · Local crew since [year]", measure: "Lead rate on this page, 28 days after the change",
  });
  // 2. blog posts with traffic
  for (const p of lp.filter((r) => isBlog(r.key) && r.sessions >= 30)) add({
    key: `blog${p.key}`, type: "Blog CTA", page: p.key, where: "In-content box after the first H2 + end of post", effort: "Low", conf: "Medium", gain: p.sessions * Math.max(0.004, lr * 0.5 - p.lr),
    title: `Add an estimate box inside ${p.key}`, why: `Blog post with ${N(p.sessions)} sessions and ${N(p.leads)} leads (${P(p.lr)}). Readers have the problem the service solves.`,
    evidence: [["Sessions (30d)", N(p.sessions)], ["Leads", N(p.leads)], ["Avg engagement", DUR(p.aet)]],
    steps: ["After the first H2, add a short box that links the topic to the service.", "Add the estimate form or a phone button at the end of the post.", "Link to the matching service page in the first paragraph."],
    suggest: "Box: Not sure if you need this? Our team will take a look and give you a written estimate. [Get an estimate] [Call now]",
  });
  // 3. mobile pages with few phone clicks
  const mob = g.sCur().filter((x) => x.deviceCategory === "mobile"), mobL = g.lCur().filter((x) => x.deviceCategory === "mobile" && g.typeOf(String(x.eventName)) === "Calls");
  const callR = sum(mobL, (x) => Number(x.eventCount)) / Math.max(1, sum(mob, (x) => Number(x.sessions)));
  if (callR > 0) {
    const ms = group(mob, (x) => String(x.land)), ml = group(mobL, (x) => String(x.land));
    [...ms].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)), c: sum(ml.get(k) ?? [], (x) => Number(x.eventCount)) })).filter((r) => r.s >= 30 && r.c / r.s < callR * 0.6).slice(0, 4).forEach((r) => add({
      key: `call${r.k}`, type: "Mobile call button", page: r.k, where: "Sticky bar at the bottom of the screen on phones", effort: "Low", conf: "High", gain: r.s * (callR * 0.8 - r.c / r.s),
      title: `Add a sticky tap-to-call bar on phones for ${r.k}`, why: `Mobile visitors here call at ${P(r.c / r.s)} vs ${P(callR)} on the rest of the site.`,
      steps: ["Add a fixed bottom bar on screens under 768px with 'Call now' and 'Estimate'.", "Make the phone number a tel: link and keep the phone click event on it.", "Check it doesn't cover the form or the cookie notice."], suggest: "Mobile sticky bar: [📞 Call now] [Get an estimate]",
    }));
  }
  // 4. form abandonment
  const fs = g.formStarts(), fl = g.formLeads();
  if (fs > 0 && 1 - fl / fs > 0.4) {
    const formPage = [...group(g.l2Cur().filter((x) => g.typeOf(String(x.eventName)) === "Forms"), (x) => String(x.pagePath))].sort((a, b) => sum(b[1], (x) => Number(x.eventCount)) - sum(a[1], (x) => Number(x.eventCount)))[0]?.[0] ?? "/contact";
    add({
      key: "form", type: "Form fix", page: formPage, where: "Estimate and contact forms", effort: "Medium", conf: "Medium", gain: (fs - fl) * 0.25,
      title: `Shorten the estimate form: ${P(1 - fl / fs)} of people who start it don't finish`, why: `${N(fs)} form starts vs ${N(fl)} submissions in 30 days.`,
      evidence: [["form_start", N(fs)], ["Form submitted", N(fl)], ["Abandonment", P(1 - fl / fs)]],
      steps: ["Cut the form to name, phone, address and a short message.", "Make email optional, and drop any CAPTCHA that shows before submit.", "Show the phone number next to the form as an alternative.", "Test the form on iPhone Safari and Android Chrome."], measure: "form_start → submit rate, 28 days after",
    });
  }
  // 5. lead actions on the site without an event
  const has = (t: string) => g.leadEvents.some((e) => g.typeOf(e) === t);
  const gaps: [string, string, string, number][] = [];
  for (const f of g.meta.crawl?.findings ?? []) {
    if (f.kind === "call" && !has("Calls")) gaps.push(["phone_click", f.action, "tel:", 3]);
    if (f.kind === "email" && !has("Email")) gaps.push(["email_click", f.action, "mailto:", 1.2]);
    if (f.kind === "sms" && !has("Text / chat")) gaps.push(["sms_click", f.action, "sms:", 1.5]);
    if (f.kind === "directions" && !has("Directions")) gaps.push(["direction_click", f.action, "https://www.google.com/maps", 1.5]);
    if (f.kind === "chat" && !has("Text / chat")) gaps.push(["chat_start", `${f.action} (${f.found.join(", ")})`, "", 1]);
    if (f.kind === "booking" && !has("Booking")) gaps.push(["booking_click", f.action, "", 1]);
  }
  for (const [e, l, prefix, gain] of gaps) add({
    key: `trk${e}`, type: "Tracking gap", page: "Site-wide", where: "Google Tag Manager", effort: "Low", conf: "High", gain,
    title: `Track ${l.toLowerCase()} as a lead event (${e})`, why: `${l} exist on ${site} but GA4 receives no event for them, so these leads are invisible.`,
    steps: ["Import the generated GTM tag (Lead setup → Tracking gaps).", "Publish the GTM container.", `Mark ${e} as a key event and map it to a lead type in the portal.`],
    suggest: prefix ? `GTM trigger: Click URL starts with ${prefix}\nGA4 event: ${e} {link_url: {{Click URL}}, link_text: {{Click Text}}, page_location: {{Page URL}}}` : `GTM trigger: the widget's open/submit event\nGA4 event: ${e} {page_location: {{Page URL}}}`,
  });
  // 6. AI assistants convert better than the site
  const aiS = g.sCur().filter((x) => x.ch === "AI Assistant"), aiL = g.lCur().filter((x) => x.ch === "AI Assistant"), ai = g.agg(aiS, aiL);
  if (ai.sessions && ai.lr > lr) {
    const pages = [...group(aiS, (x) => String(x.land))].sort((a, b) => sum(b[1], (x) => Number(x.sessions)) - sum(a[1], (x) => Number(x.sessions))).slice(0, 3).map(([k]) => k);
    add({
      key: "ai", type: "AI assistant traffic", page: pages[0] ?? "/", where: "Pages AI assistants send people to + /llms.txt", effort: "Medium", conf: "Medium", gain: ai.sessions * 0.5 * ai.lr,
      title: `Grow AI assistant referrals: they convert at ${P(ai.lr)}`, why: `AI assistants sent ${N(ai.sessions)} sessions with ${N(ai.leads)} leads, above the site's ${P(lr)}. Top pages: ${pages.join(", ")}.`,
      steps: ["Make these pages answer-ready: short answer at the top, clear prices or ranges, FAQ.", "List them in /llms.txt with one-line summaries.", "Keep business facts (services, areas, phone) identical across the site, Google Business Profile and directories."],
    });
  }
  // 7. service-area cities that don't convert
  for (const c of g.byGeo((x) => (g.inArea(String(x.city)) ? String(x.city) : null)).filter((r) => r.sessions >= 40 && r.lr < lr * 0.8)) add({
    key: `city${c.key}`, type: "Local proof", page: `/ (and a ${c.key} page)`, where: `Projects and reviews from ${c.key}`, effort: "Medium", conf: "Low", gain: c.sessions * (lr - c.lr) * 0.5,
    title: `Show ${c.key} projects and reviews to visitors from ${c.key}`, why: `${N(c.sessions)} sessions from ${c.key} but a lead rate of ${P(c.lr)} vs ${P(lr)}.`,
    steps: [`Add 2–3 recent ${c.key} projects with photos to the home page and your work page.`, `Quote a review from a ${c.key} customer.`, `Create or improve the ${c.key} city page (see Search Console quick wins).`],
  });
  // 8. peak call hours
  const calls = g.l2Cur().filter((x) => g.typeOf(String(x.eventName)) === "Calls");
  if (calls.length) {
    const hrs = [...group(calls, (x) => String(x.dateHour).slice(11, 13))].map(([h, v]) => [h, sum(v, (x) => Number(x.eventCount))] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `${h}:00`);
    add({
      key: "hours", type: "Answer every call", page: "Phone line", where: "Office process + website after-hours message", effort: "Low", conf: "Medium", gain: sum(calls, (x) => Number(x.eventCount)) * 0.1,
      title: `Make sure calls are answered at peak times (${hrs.join(", ")})`, why: `Phone clicks peak at ${hrs.join(", ")}. Missed calls at peak are lost leads.`,
      steps: ["Staff the phone or forward to a mobile during the peak hours.", "After hours, show 'Leave your number and we'll call you first thing' next to the phone button.", "Connect call tracking to see answered vs missed calls."],
    });
  }
  // 9. Google Ads campaigns above the target cost per lead ($60)
  const adsCur = g.ads.filter((x) => g.inCur(x));
  for (const [camp, rows] of group(adsCur, (x) => String(x.sessionGoogleAdsCampaignName))) {
    const cost = sum(rows, (x) => Number(x.advertiserAdCost)), leads = sum(g.l2Cur().filter((x) => x.sessionCampaignName === camp), (x) => Number(x.eventCount));
    const cpl = leads ? cost / leads : cost;
    if (cpl > 60) add({
      key: `ads${camp}`, type: "Ads budget", page: `Google Ads: ${camp}`, where: "Google Ads campaign settings", effort: "Low", conf: "Medium", gain: cost / 60 - leads,
      title: `Cut cost per lead on '${camp}' ($${N(cpl)} per lead)`, why: `$${N(cost)} spent for ${N(leads)} leads in 30 days.`,
      steps: ["Check search terms and add negatives for job seekers, DIY and suppliers.", "Send clicks to the matching service or city page instead of the home page.", "Move budget to the campaign with the lowest cost per lead."],
    });
  }
  // 10. social traffic sent to the home page
  const socS = g.sCur().filter((x) => x.ch === "Organic Social"), soc = g.agg(socS, g.lCur().filter((x) => x.ch === "Organic Social"));
  const socHome = sum(socS.filter((x) => x.land === "/"), (x) => Number(x.sessions));
  if (soc.sessions >= 10 && soc.lr < lr && socHome / Math.max(1, soc.sessions) >= 0.4) add({
    key: "social", type: "Landing page CTA", page: "/", where: "Social post links (Facebook, Instagram, Nextdoor…)", effort: "Low", conf: "Medium", gain: soc.sessions * (lr * 0.6 - soc.lr),
    title: "Send social posts to a matching page, not the home page", why: `Organic Social brings ${N(soc.sessions)} sessions at ${P(soc.lr)} lead rate and ${P(soc.er)} engagement, ${P(socHome / soc.sessions)} of them to the home page.`,
    steps: ["Link each post to the page about its topic.", "Add UTM tags: utm_source=facebook&utm_medium=social&utm_campaign=<post>.", "Pin a post with the estimate link."],
  });
  // 11. data quality and configuration
  const cfg = g.meta.config;
  const dq: [string, string, string][] = [];
  if (g.botSlices.size) dq.push(["Exclude bot traffic", `${g.botSlices.size} day × country × browser slices had many sessions and almost no engagement.`, "Create a GA4 data filter or a Cloudflare bot rule; the portal already excludes them from lead reports."]);
  if (cfg.retention && cfg.retention !== "FOURTEEN_MONTHS" && !/MONTHS_(26|38|50)/.test(cfg.retention)) dq.push(["Set data retention to 14 months", `Retention is ${cfg.retention.toLowerCase().replace(/_/g, " ")}, which limits explorations and year-over-year.`, "Admin → Data retention → 14 months."]);
  if (cfg.searchConsole === false) dq.push(["Link Search Console to GA4", "Without the link, organic queries can't be joined to leads inside GA4.", "Admin → Product links → Search Console links."]);
  if (cfg.bigquery === false) dq.push(["Turn on the BigQuery export", "Needed for the lead log, paths and time-to-lead reports.", "Admin → Product links → BigQuery links → daily export."]);
  const gbpUntagged = sum(g.sCur().filter((x) => /gbp|google business|business\.google/i.test(String(x.sessionSourceMedium))), (x) => Number(x.sessions)) === 0;
  if (gbpUntagged) dq.push(["Tag the Google Business Profile link", "No sessions carry a Business Profile tag, so those visits land in Organic Search or Direct.", "Use ?utm_source=google&utm_medium=organic&utm_campaign=gbp on the website link in the Business Profile."]);
  const selfRef = g.sCur().filter((x) => g.meta.streamUrl && String(x.sessionSourceMedium).includes(new URL(g.meta.streamUrl).hostname.replace(/^www\./, "")) && g.medium(x) === "referral");
  if (selfRef.length) dq.push(["List your own domain as an unwanted referral", `${N(sum(selfRef, (x) => Number(x.sessions)))} sessions come from your own site as a referral (self-referral).`, "Admin → Data streams → Configure tag settings → List unwanted referrals."]);
  dq.forEach(([t, w, s1], i) => add({ key: `cfg${i}${t}`, type: "Data quality", page: "GA4 property", where: "GA4 Admin", effort: "Low", conf: "High", gain: 0.5, title: t, why: w, steps: [s1] }));
  // 12. the best-converting landing page
  const best = lp.filter((r) => r.sessions >= 20 && r.leads > 0).sort((a, b) => b.lr - a.lr)[0];
  if (best && lr > 0) add({
    key: "best", type: "Promote a winner", page: best.key, where: "Main navigation, home page and ads", effort: "Low", conf: "Medium", gain: best.lr * 40,
    title: `Send more traffic to ${best.key}, the best-converting page (${P(best.lr)})`, why: `Lead rate ${P(best.lr)} on ${N(best.sessions)} sessions, ${(best.lr / lr).toFixed(1)}× the site average.`,
    steps: ["Link to it from the home page and the main navigation.", "Use it as the landing page for matching ads.", "Copy its layout (CTA placement, proof) to similar pages."],
  });
  // 13. landing pages that don't engage
  for (const p of lp.filter((r) => r.sessions >= 50 && r.er < 0.4)) add({
    key: `eng${p.key}`, type: "Engagement fix", page: p.key, where: "First screen (speed, headline, mobile layout)", effort: "Medium", conf: "Low", gain: p.sessions * Math.max(0.002, lr * 0.3),
    title: `Fix the first screen of ${p.key}: ${P(1 - p.er)} of visits leave without engaging`, why: `${N(p.sessions)} sessions with an engagement rate of ${P(p.er)}.`,
    steps: ["Check the page speed (PageSpeed / Core Web Vitals) on mobile.", "Make the headline match what people searched for or the ad they clicked.", "Check the mobile layout: no pop-up or banner covering the first screen."],
  });
  const ranked = out.map((w) => ({ ...w, score: Math.round(((w.gain * CONF[w.conf]) / EFF[w.effort]) * 100) / 100, rank: 0 })).sort((a, b) => b.score - a.score);
  ranked.forEach((w, i) => { w.rank = i + 1; });
  return ranked;
}

