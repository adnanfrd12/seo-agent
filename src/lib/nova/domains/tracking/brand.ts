import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { saveBrandTerms } from "@/app/(dashboard)/brand-actions";
import { defaultBrandTerms, domainLabel, normalizeTerm, normalizeTerms } from "@/lib/brand";
import { fromAction, json, plural, read, write, type NovaTool } from "../../kit";
import { compact, quoted, readTarget, uniq } from "./shared";

/** Brand terms: which Search Console queries count as branded, and the words that spot the business in AI answers (brand-actions.ts saves them). */
const MAX_TERMS = 12; // normalizeTerms() keeps 12
const USED_FOR = "Search Console's branded vs non-branded split, and spotting the business in AI visibility answers";
const RULES = "lower case letters and digits only, at least 4, up to 12 terms; matched against searches with spaces and punctuation removed (“LED Lights” → “ledlights”)";
// a website given as a term counts by its name, as in the defaults ("ledlightsandsigns.com" → "ledlightsandsigns"), not "ledlightsandsignscom"
const DOMAIN_LIKE = /^(https?:\/\/|sc-domain:|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|co|io|us|biz|info|uk|ca|au|nz|ie|in|pk|ph|sg|ae|za|de|fr|es|mx)\/?$/i;
const termOf = (raw: string) => (DOMAIN_LIKE.test(raw.trim()) ? domainLabel(raw.trim()) ?? normalizeTerm(raw) : normalizeTerm(raw));

/** The saved terms, or the defaults each feature falls back to (Search Console: client name + site names; AI visibility: client name + research website). */
async function brandState(admin: SupabaseClient, client: { id: string; name: string }) {
  const [{ data: c }, { data: sites }, target] = await Promise.all([
    admin.from("clients").select("name, settings").eq("id", client.id).maybeSingle(),
    admin.from("integration_resources").select("display_name").eq("client_id", client.id).eq("provider", "gsc").eq("is_selected", true),
    readTarget(admin, client.id),
  ]);
  const name = (c?.name as string | undefined) ?? client.name;
  const raw = (c?.settings as { brand_terms?: unknown } | null)?.brand_terms;
  const saved = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string" && Boolean(t)) : [];
  const searchConsole = defaultBrandTerms(name, (sites ?? []).map((s) => s.display_name as string | null));
  const aiVisibility = defaultBrandTerms(name, target ? [target.domain] : []);
  return { saved, searchConsole, aiVisibility, current: saved.length ? saved : uniq([...searchConsole, ...aiVisibility]) };
}

export const tools: NovaTool[] = [
  read({
    name: "get_brand_terms",
    description: "The brand terms that mark Search Console searches as branded and spot the business in AI assistant answers: the saved list, or the defaults in use when none is saved.",
    schema: z.object({}),
    async run(ctx) {
      const s = await brandState(ctx.admin, ctx.client);
      return json(compact({
        saved: s.saved.length ? s.saved : "none saved, so defaults are used",
        defaults_in_use: s.saved.length ? null : { search_console: s.searchConsole, ai_visibility: s.aiVisibility },
        used_for: USED_FOR, rules: RULES,
      }));
    },
    summary: () => "Read brand terms",
  }),

  write({
    name: "set_brand_terms",
    description: "Change the brand terms (the business or website name as people search it): replace the whole list, or add / remove terms. Free.",
    schema: z.object({
      terms: z.array(z.string().trim().min(1).max(80)).max(MAX_TERMS).optional().describe("replaces the whole list"),
      add: z.array(z.string().trim().min(1).max(80)).max(MAX_TERMS).optional(),
      remove: z.array(z.string().trim().min(1).max(80)).max(MAX_TERMS).optional(),
    }),
    async prepare(ctx, a) {
      if (!a.terms && !a.add?.length && !a.remove?.length) return { error: "Give terms (to replace the list), add or remove." };
      const s = await brandState(ctx.admin, ctx.client);
      const incoming = [...(a.terms ?? []), ...(a.add ?? [])];
      const short = incoming.filter((t) => termOf(t).length < 4);
      if (short.length) return { error: `Brand terms need at least 4 letters or digits: ${short.map(quoted).join(", ")}.` };
      const base = uniq([...(a.terms ? [] : s.current), ...incoming.map(termOf)]);
      const drop = (a.remove ?? []).map(termOf);
      const unknown = (a.remove ?? []).filter((t) => !base.includes(termOf(t)));
      const websites = incoming.filter((t) => termOf(t) !== normalizeTerm(t)).map((t) => `${t} → ${termOf(t)}`);
      if (unknown.length) return { error: `Not a brand term now: ${unknown.map(quoted).join(", ")}. Current terms: ${base.join(", ")}.` };
      const list = base.filter((t) => !drop.includes(t));
      if (list.length > MAX_TERMS) return { error: `At most ${MAX_TERMS} brand terms; this would make ${list.length}.` };
      const next = normalizeTerms(list); // what saveBrandTerms() stores
      if (!next.length) return { error: "Keep at least one brand term." };
      if (s.saved.length && next.join() === s.saved.join()) return { error: `The brand terms are already exactly: ${next.join(", ")}.` };
      const before = s.saved.length ? s.saved : s.current;
      const added = next.filter((t) => !before.includes(t)), removed = before.filter((t) => !next.includes(t));
      return {
        title: s.saved.length ? `Update the brand terms (${plural(next.length, "term")})` : `Save ${plural(next.length, "brand term")}`,
        detail: [
          `Brand terms: ${s.saved.length ? s.saved.join(", ") : `none saved (defaults in use: ${s.current.join(", ")})`} → ${next.join(", ")}`,
          added.length ? `Added: ${added.join(", ")}` : "",
          removed.length ? `Removed: ${removed.join(", ")}` : "",
          websites.length ? `Websites count by their name: ${websites.join(", ")}` : "",
          `Used for ${USED_FOR}.`,
        ].filter(Boolean).join("\n"),
        input: { terms: next },
      };
    },
    async execute(_x, a) {
      return fromAction(await saveBrandTerms((a.terms ?? []).join(", ")), "Brand terms saved.", ["/search-console", "/ai-visibility"]);
    },
  }),
];
