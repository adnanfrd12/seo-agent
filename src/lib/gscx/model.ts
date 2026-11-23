/**
 * Search Console module rules and arithmetic (no I/O): the segment engine (RE2-style regexes with
 * {BRAND_TERMS}/{CITIES}/{SERVICES}/{COMPETITORS} placeholders), expected CTR by position, query helpers.
 */

export interface GscSettings { brand: string[]; competitors: string[]; cities: string[]; services: string[] }

/** Escaped alternation for a list of terms (longest first so "led lights and signs" wins over "led"). */
export const alt = (terms: string[]) => [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "a^";

export interface Segment { id: string; name: string; rx: string; exclude?: boolean }
const NEVER = "a^"; // matches nothing (used when a placeholder list is empty)
/** Built-in segments (RE2 syntax, case-insensitive). */
export function segments(s: GscSettings): Segment[] {
  const B = s.brand.length ? alt(s.brand) : NEVER, CI = s.cities.length ? alt(s.cities) : NEVER, SV = s.services.length ? alt(s.services) : NEVER, CO = s.competitors.length ? alt(s.competitors) : NEVER;
  return [
    { id: "brand", name: "Brand", rx: `\\b(${B})\\b` },
    { id: "nonbrand", name: "Non-brand", rx: `\\b(${B})\\b`, exclude: true },
    { id: "questions", name: "Questions", rx: "^(who|what|when|where|why|how|which|is|are|can|could|does|do|should|will)\\b" },
    { id: "questions_any", name: "Questions anywhere", rx: "\\b(who|what|when|where|why|how|which)\\b|\\?" },
    { id: "howto", name: "How-to", rx: "\\bhow (to|do|does|can|much|long|often|many)\\b" },
    { id: "prompt8", name: "Prompt-like 8+ words", rx: "^(\\S+\\s+){7,}\\S+$" },
    { id: "w10", name: "10+ words", rx: "^(\\S+\\s+){9,}\\S+$" },
    { id: "w15", name: "15+ words", rx: "^(\\S+\\s+){14,}\\S+$" },
    { id: "longtail", name: "Long-tail 5+ words", rx: "^(\\S+\\s+){4,}\\S+$" },
    { id: "single", name: "Single word", rx: "^\\S+$" },
    { id: "aiverbs", name: "AI instruction verbs", rx: "^(explain|tell me|give me|show me|list|write|help|find|recommend|suggest|compare|summarize|create)\\b" },
    { id: "firstperson", name: "First-person", rx: "\\b(i|im|i'm|my|me|we|our|us)\\b" },
    { id: "fillers", name: "Conversational fillers", rx: "\\b(please|thanks|can you|could you|i need|i want|looking for)\\b" },
    { id: "price", name: "Price and cost", rx: "\\b(cost|costs|price|prices|pricing|how much|quote|estimate|cheap|affordable|financing)\\b" },
    { id: "comparison", name: "Comparison", rx: "\\b(vs\\.?|versus|compare|comparison|difference between|better than)\\b" },
    { id: "alternatives", name: "Alternatives", rx: "\\b(alternative|alternatives|instead of|similar to)\\b" },
    { id: "best", name: "Best/top", rx: "\\b(best|top|top rated|recommended)\\b" },
    { id: "reviews", name: "Reviews and trust", rx: "\\b(review|reviews|rating|legit|scam|complaint|bbb|reddit|yelp)\\b" },
    { id: "nearme", name: "Near me", rx: "\\bnear (me|by)\\b|\\bnearby\\b|\\bclosest\\b" },
    { id: "cities", name: "Cities", rx: `\\b(${CI})\\b` },
    { id: "services", name: "Services", rx: `\\b(${SV})\\b` },
    { id: "competitors", name: "Competitors", rx: `\\b(${CO})\\b` },
    { id: "problems", name: "Problems", rx: "\\b(leak|leaking|damage|damaged|broken|crack|missing|mold|rot|sagging|not working)\\b" },
    { id: "repair", name: "Repair/replace/install", rx: "\\b(repair|fix|replace|replacement|install|installation)\\b" },
    { id: "diy", name: "DIY", rx: "\\b(diy|myself|yourself|tutorial|step by step)\\b" },
    { id: "hire", name: "Hire a pro", rx: "\\b(contractor|company|companies|service|services|professional|hire)\\b" },
    { id: "urgent", name: "Urgent", rx: "\\b(emergency|urgent|24/7|same day|asap|tonight)\\b" },
    { id: "definitions", name: "Definitions", rx: "^(what is|what are|what does|define|meaning of)\\b" },
    { id: "year", name: "Year", rx: "\\b20[2-3][0-9]\\b" },
    { id: "contact", name: "Contact/navigational", rx: "\\b(phone|number|call|contact|address|hours|directions)\\b" },
    { id: "login", name: "Login", rx: "\\b(login|log in|sign in|portal|account)\\b" },
    { id: "jobs", name: "Jobs", rx: "\\b(job|jobs|career|careers|hiring|salary)\\b" },
    { id: "free", name: "Free", rx: "\\b(free|no cost|complimentary)\\b" },
    { id: "image", name: "Image intent", rx: "\\b(picture|pictures|photo|photos|images|ideas|colors|design)\\b" },
    { id: "video", name: "Video intent", rx: "\\b(video|youtube|watch)\\b" },
    { id: "warranty", name: "Warranty", rx: "\\b(warranty|guarantee|certified)\\b" },
    { id: "seasonal", name: "Seasonal/time", rx: "\\b(how long|lifespan|when to|how often|winter|summer)\\b" },
    { id: "url", name: "URL typed as query", rx: "\\.(com|net|org)\\b|www\\." },
    { id: "nonlatin", name: "Non-Latin characters", rx: "[^\\x00-\\x7F]" },
  ];
}
/** RE2 rules: no lookarounds or backreferences, at most 4,096 characters. Returns an error message or null. */
export function re2Error(rx: string): string | null {
  if (rx.length > 4096) return "Longer than 4,096 characters.";
  if (/\(\?[=!<]/.test(rx)) return "Lookaheads and lookbehinds aren't supported in RE2 (Search Console's regex engine).";
  if (/\\[1-9]/.test(rx)) return "Backreferences aren't supported in RE2.";
  try { new RegExp(rx, "i"); return null; } catch (e) { return e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : "Invalid pattern."; }
}
export const matcher = (seg: Segment) => { const re = new RegExp(seg.rx, "i"); return (q: string) => (seg.exclude ? !re.test(q) : re.test(q)); };

/** Benchmark CTR by position (fallback when the site's own curve has too little data). */
export function benchmarkCtr(p: number) {
  const r = Math.max(1, Math.round(p));
  return r <= 10 ? [0.3, 0.16, 0.1, 0.07, 0.055, 0.045, 0.035, 0.03, 0.025, 0.02][r - 1] : r <= 15 ? 0.011 : r <= 20 ? 0.007 : 0.002;
}
export const words = (q: string) => q.trim().split(/\s+/).filter(Boolean).length;
export const LEN_BANDS: [string, number, number][] = [["1", 1, 1], ["2", 2, 2], ["3-4", 3, 4], ["5-7", 5, 7], ["8-14", 8, 14], ["15+", 15, 999]];
export const POS_BUCKETS: [string, number, number][] = [["1-3", 0, 3.5], ["4-10", 3.5, 10.5], ["11-20", 10.5, 20.5], ["21-50", 20.5, 50.5], ["51+", 50.5, 1e9]];
export const isQuestion = (q: string) => /^(who|what|when|where|why|how|which|is|are|can|could|does|do|should|will)\b|\?/i.test(q);
/** Path of a URL; http:// and www. versions keep their host so duplicates of the same page stay distinguishable. */
export const pathOf = (u: string) => { try { const x = new URL(u); const p = x.pathname + x.search + x.hash; return x.protocol === "http:" || x.hostname.startsWith("www.") ? `${x.protocol === "http:" ? "http://" : ""}${x.hostname}${p}` : p; } catch { return u; } };
/** Site section of a URL (for "where clicks land"). */
export function section(u: string) {
  const p = pathOf(u).toLowerCase();
  if (p === "/" || p === "") return "Home page";
  if (/^\/(blog|news|articles?|posts?)(\/|$)/.test(p) || /^\/\d{4}\//.test(p)) return "Blog posts";
  if (/contact|quote|estimate|request|book/.test(p)) return "Contact";
  if (/about|team|reviews?|testimonials?|faq|privacy|terms/.test(p)) return "Company pages";
  if (/our-work|portfolio|gallery|projects/.test(p)) return "Our work";
  if (/(-tx|-texas|houston|katy|sugar-land|near-me|city|location|service-area|areas)/.test(p)) return "City pages";
  return "Services";
}
const STOP = new Set(["the", "and", "for", "with", "your", "you", "near", "from", "that", "this", "what", "how", "are", "can", "does", "best", "top"]);
/** Words of a query that matter (longer than 3 letters, crude stemming). */
export const stems = (q: string) => q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/(ings|ing|ers|er|es|s)$/, ""));
export function lev(a: string, b: string) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
export const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
