/**
 * Site audit detail panels: what each issue or metric opens, and how to fix it. No server code, so the panel
 * (a client component) and the server loader share it.
 */

/** Totals in the "Links and duplicates" box that open a panel, keyed like the issues (prefixed "m_"). */
export const METRIC_KEYS = {
  m_internal_links: "Internal links",
  m_external_links: "External links",
  m_broken_links: "Broken links",
  m_duplicate_title: "Duplicate titles",
  m_duplicate_description: "Duplicate descriptions",
  m_duplicate_content: "Duplicate content pages",
  m_non_indexable: "Non-indexable pages",
} as const;
export type MetricKey = keyof typeof METRIC_KEYS;

/** Short, specific steps per issue type. Keys match the audit catalog; metrics reuse the closest issue. */
export const HOW_TO: Record<string, string[]> = {
  is_5xx_code: ["Open each URL and check the server error log for the time it failed.", "Fix the crashing template or plugin, or return 410 if the page is gone for good.", "Re-run the audit to confirm a 200 answer."],
  is_4xx_code: ["Restore the page if it was removed by mistake.", "Otherwise add a 301 redirect to the closest live page.", "Update the internal links listed under “Linked from” so they point straight at the live page."],
  no_title: ["Add a <title> in the page's SEO settings (Yoast / Rank Math: “SEO title”).", "Keep it 30-60 characters with the main keyword first and the brand last.", "Make it different from every other page's title."],
  canonical_to_broken: ["Edit the canonical tag (SEO plugin → Advanced → Canonical URL).", "Point it at a URL that answers 200, usually the page itself."],
  recursive_canonical: ["Set the canonical to the page's own final URL.", "Check no plugin or template adds a second canonical tag."],
  is_http: ["Force HTTPS on the server or CDN (301 from http:// to https://).", "Replace http:// internal links and image addresses with https://."],
  duplicate_title: ["Each group below shares one title.", "Rewrite every title in the group so it names what makes that page different (service, city, product).", "Keep the main keyword, 30-60 characters."],
  no_description: ["Write a 70-160 character meta description per page (SEO plugin → Meta description).", "Summarise the page and end with a reason to click (call, quote, see prices)."],
  duplicate_description: ["Each group below shares one description.", "Write a unique description per page, or leave it empty so Google picks text from the page."],
  duplicate_content: ["Each group lists pages with nearly the same text.", "Keep the strongest page and merge the others into it with 301 redirects, or", "rewrite the copies so each covers its own topic or location, or add a canonical tag pointing at the main page."],
  no_h1_tag: ["Add one H1 heading near the top of the page that states its topic.", "In most page builders: set the main heading's tag to H1 (and only one per page)."],
  title_too_long: ["Cut each title to about 60 characters; Google truncates the rest.", "Lead with the main keyword, drop lists of ZIP codes or repeated phrases, keep the brand at the end."],
  is_redirect: ["These URLs forward elsewhere; that is fine for old addresses.", "Find internal links that still point at them and change those links to the final URL."],
  has_links_to_redirects: ["Each row is a link on your site that goes through a redirect.", "Edit the link on the “From” page so it points at the final address shown in “To”'s redirect."],
  canonical_chain: ["Change each canonical so it points straight at the final page, not at a page that has its own canonical."],
  canonical_to_redirect: ["Replace the canonical URL with the redirect's destination."],
  https_to_http_links: ["Change each http:// link to https://, or remove it if the target has no secure version."],
  redirect_chain: ["Each row is a chain of redirects.", "Change the first redirect to go straight to the last URL, and update links to the last URL."],
  is_broken: ["Each row is a link that returns an error.", "Fix the target (restore or redirect it) or edit the link on the “From” page to a working URL, or remove it."],
  is_orphan_page: ["No other page links to these pages, so visitors and Google rarely reach them.", "Add a link from a related service page, blog post or the menu/footer, using descriptive anchor text.", "If a page is obsolete, redirect it to a better page and remove it from the sitemap."],
  high_loading_time: ["Compress and resize large images (WebP, correct dimensions).", "Turn on page caching and a CDN.", "Remove unused plugins and heavy scripts on these pages."],
  low_content_rate: ["The page is mostly code. Add useful visible text (service details, FAQs).", "Remove unused scripts, inline styles and page-builder bloat."],
  title_too_short: ["Expand the title to 30-60 characters: main keyword, what the page offers, brand."],
  no_image_alt: ["Add an alt attribute that describes each meaningful image in a few words (Media Library → Alternative text).", "Use alt=\"\" only for purely decorative images.", "Mention the product or service naturally; don't stuff keywords."],
  no_image_title: ["Add a short title to key images (Media Library → Title).", "Titles are optional; alt text matters more."],
  html_errors: ["Each row is an HTML error with its line number in the page source (view-source:).", "Fix it in the theme, template or custom HTML block that outputs that line; errors repeating on many pages come from a shared template."],
  thin_content: ["Expand each page with details people search for: what, where, price ranges, process, FAQs.", "Merge very similar thin pages into one stronger page."],
  non_indexable: ["Check why each page is blocked (noindex tag, robots.txt, canonical elsewhere).", "Remove the block on pages that should appear in Google; leave it on private or duplicate pages."],
  links: ["This is the full link list from the crawl, for reference.", "Look for links with an error status or a redirect and fix them on the “From” page."],
};

const METRIC_GUIDE: Record<string, string> = {
  orphans: "is_orphan_page",
  m_internal_links: "links", m_external_links: "links", m_broken_links: "is_broken", m_duplicate_title: "duplicate_title",
  m_duplicate_description: "duplicate_description", m_duplicate_content: "duplicate_content", m_non_indexable: "non_indexable",
};
export const howTo = (key: string): string[] => HOW_TO[key] ?? HOW_TO[METRIC_GUIDE[key] ?? ""] ?? [];

/* ------------------------------------------------------------------ Claude cost estimates (claude-opus-5-5, $4 / $20 per 1M tokens) */
export const AI_FIX_MAX_ITEMS = 30;
export const ALT_BATCH = 10;
const usd = (inTok: number, outTok: number) => (inTok * 4 + outTok * 20) / 1_000_000;
/** One "Fix with AI" run over `items` affected pages / links / groups. */
export const estimateFixCost = (items: number) => Number(usd(2500 + 180 * Math.min(items, AI_FIX_MAX_ITEMS), 400 + 200 * Math.min(items, AI_FIX_MAX_ITEMS)).toFixed(3));
/** One alt-text run: each image is about 1,600 input tokens at most. */
export const estimateAltCost = (images: number) => Number(usd(800 + 1700 * Math.min(images, ALT_BATCH), 200 + 120 * Math.min(images, ALT_BATCH)).toFixed(3));
