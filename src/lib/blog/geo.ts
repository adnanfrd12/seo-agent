import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic } from "@/lib/ai/claude";

/**
 * Reads a post the way a local-SEO reviewer would: the search phrase it targets, and every place it
 * names (neighbourhoods, road crossings, landmarks, ZIP codes). Claude Haiku 5.5 with thinking off:
 * a ~1,000-word post costs about $0.0003. Only names that appear in the text are returned.
 */
export const GEO_MODEL = "claude-haiku-5-5";
// $ per million tokens for claude-haiku-5-5 (prompts under 100K tokens)
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01 };

const schema = z.object({
  target_keyword: z.string(),
  secondary_keywords: z.array(z.string()),
  neighborhoods: z.array(z.string()),
  road_crossings: z.array(z.string()),
  landmarks: z.array(z.string()),
  city: z.string().nullable(),
  zip_codes: z.array(z.string()),
});
export type GeoRead = z.infer<typeof schema>;

const SYSTEM = `You read blog posts written by local businesses and return what a local-SEO reviewer records. Use only what the text says; never add places from your own knowledge.
- target_keyword: the main service search phrase the post is written to rank for, lower case, without place names (e.g. "office signs", "ada door signs"). 2-5 words.
- secondary_keywords: up to 5 other search phrases the post covers, lower case, without place names.
- neighborhoods: named neighbourhoods, subdivisions, districts or suburbs the post targets or mentions (not the main city, not a street).
- road_crossings: intersections or pairs of roads named together, written "Road A & Road B" with the roads' names as written (e.g. "Interstate 10 Frontage Rd & N Fry Rd").
- landmarks: named places people would recognise: parks, schools, churches, hospitals, malls, stadiums, venues, government buildings. Not roads, not businesses being recommended.
- city: the main city the post is about, or null.
- zip_codes: 5-digit ZIP codes written in the text.
Return empty lists when the text names nothing of that kind.`;

export async function readGeo(post: { title: string; text: string; place: string | null; city: string | null }): Promise<{ geo: GeoRead; cost: number }> {
  const res = await anthropic().beta.messages.parse({
    model: GEO_MODEL, max_tokens: 1200, thinking: { type: "disabled" },
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Business city: ${post.city ?? "unknown"}\nArea named in the post's map link: ${post.place ?? "none"}\nTitle: ${post.title}\n\n<post>\n${post.text.slice(0, 12_000)}\n</post>`,
    }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to read this post.");
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("No structured answer for this post.");
  const u = res.usage;
  const cost = (u.input_tokens * PRICE.input + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + u.output_tokens * PRICE.output) / 1_000_000;
  const clean = (l: string[], n: number) => [...new Set(l.map((x) => x.trim().replace(/\s+/g, " ")).filter((x) => x.length > 1 && x.length < 120))].slice(0, n);
  return {
    geo: {
      target_keyword: parsed.target_keyword.trim().toLowerCase().slice(0, 80),
      secondary_keywords: clean(parsed.secondary_keywords.map((k) => k.toLowerCase()), 5),
      neighborhoods: clean(parsed.neighborhoods, 10), road_crossings: clean(parsed.road_crossings, 10), landmarks: clean(parsed.landmarks, 12),
      city: parsed.city?.trim() || null, zip_codes: clean(parsed.zip_codes.filter((z) => /^\d{5}$/.test(z.trim())), 5),
    },
    cost: Number(cost.toFixed(6)),
  };
}
