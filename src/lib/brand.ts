/**
 * Brand terms decide which Search Console queries count as "branded". They are matched against a query
 * with its spaces removed, so "led lights and signs" matches the term "ledlightsandsigns". Terms come
 * from the website's name and the client name, and the client can edit them.
 */
const LEGAL = new Set(["llc", "inc", "ltd", "co", "corp", "company", "the"]);

export const normalizeTerm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalizeTerms(list: string[]): string[] {
  return [...new Set(list.map(normalizeTerm).filter((t) => t.length >= 4))].slice(0, 12);
}

/** Domain label of a Search Console property (sc-domain:example.com, https://www.example.com/ -> "example"). */
export function domainLabel(site: string | null | undefined): string | null {
  if (!site) return null;
  const host = site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const label = host.split(".")[0];
  return label ? normalizeTerm(label) : null;
}

export function defaultBrandTerms(clientName: string, sites: (string | null | undefined)[]): string[] {
  const nameJoined = clientName.toLowerCase().split(/\s+/).filter((w) => !LEGAL.has(w)).join("");
  return normalizeTerms([nameJoined, ...sites.map(domainLabel).filter((x): x is string => Boolean(x))]);
}
