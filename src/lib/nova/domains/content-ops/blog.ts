import "server-only";
import { z } from "zod";
import { crawlBlogNow, fetchBlogKeywordsNow, syncBlogNow } from "@/app/(dashboard)/blog/actions";
import { claudeBudget } from "@/lib/ai/usage";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { keywordCost, POST_KW_EST } from "@/lib/blog/keywords";
import { analyseBlog, ISSUE_ORDER, ISSUES, loadBlog, loadBlogPerformance, type BlogAnalysis, type BlogPerf, type BlogPost, type IssueKey } from "@/lib/blog/load";
import { pathOf } from "@/lib/blog/parse";
import { auditEstimate, DEFAULT_AUDIT_PAGES, loadAudit } from "@/lib/dataforseo/audit";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { bullets, fromAction, json, plural, read, ToolError, write, type NovaCtx, type NovaTool } from "../../kit";
import { ago, clip, compactObj, dfsLeftToday, fit, usd, websiteOf, when } from "./shared";

/**
 * Blog Content (/blog): the stored posts (blog_posts) with their Google performance, and the page's three buttons:
 * read the blog now, DataForSEO keywords for new or all posts, and posts found by the site crawler.
 */

// the code's own numbers (not exported where they live)
const RUN_COST_LIMIT = 0.5; // lib/blog/sync.ts: $ of Claude reading per run
const GEO_EST = 0.0003; // lib/blog/geo.ts: a ~1,000-word post
const KW_FRESH_DAYS = 7, KW_NEW_DAYS = 60; // lib/blog/keywords.ts
const KW_MAX_PAID = 400; // blog/actions.ts fetchBlogKeywordsNow
const CRAWL_RECENT_DAYS = 14; // blog/actions.ts crawlBlogNow
const CRAWL_STALE_MS = 3 * 3_600_000; // lib/dataforseo/audit.ts
const DAY = 86_400_000;

const ISSUE_KEYS = ISSUE_ORDER as [IssueKey, ...IssueKey[]];
const mapState = (p: BlogPost) => (!p.map ? "none" : p.map.matches_profile ? "your profile" : p.map.matches_profile === false ? "other place" : "map");

function findPost(posts: BlogPost[], q: string): BlogPost {
  const s = q.trim(), low = s.toLowerCase();
  const byId = posts.find((p) => p.id === s);
  if (byId) return byId;
  if (/^(https?:\/\/|\/)/i.test(s)) {
    const path = pathOf(s);
    const byUrl = posts.find((p) => p.url === s || (path && pathOf(p.url) === path));
    if (byUrl) return byUrl;
  }
  const exact = posts.find((p) => p.title.toLowerCase() === low);
  if (exact) return exact;
  const some = posts.filter((p) => p.title.toLowerCase().includes(low) || p.url.toLowerCase().includes(low));
  if (some.length === 1) return some[0];
  if (some.length > 1) throw new ToolError(`${some.length} posts match "${clip(s, 60)}". Use one id: ${some.slice(0, 8).map((p) => `${p.id} (${clip(p.title, 60)})`).join("; ")}`);
  throw new ToolError(`No blog post matches "${clip(s, 80)}". List the posts first to get real ids.`);
}

function postDetail(p: BlogPost, a: BlogAnalysis, f: BlogPerf | undefined) {
  const path = pathOf(p.url);
  const kinds: Record<string, number> = {};
  for (const l of p.links) kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
  const dfs = p.keywords?.dfs ?? [];
  return compactObj({
    id: p.id, title: p.title, url: p.url, dashboard_page: `/blog/${p.id}`,
    published: p.published_date, modified: p.modified_at?.slice(0, 10), categories: p.categories, tags: p.tags, words: p.word_count,
    featured_image: p.featured_image ? (p.featured_image.unreadable ? "set (details not readable)" : p.featured_image.alt ? `alt text: ${clip(p.featured_image.alt, 120)}` : "no alt text") : "none",
    keywords: compactObj({
      target: p.keywords?.target, secondary: p.keywords?.secondary,
      dataforseo: dfs.length || p.keywords?.dfs_source ? compactObj({
        list: p.keywords?.dfs_source === "page" ? "the post's own list" : "matched from the site's keyword list", checked: p.keywords?.dfs_at?.slice(0, 10),
        top: dfs.slice(0, 15).map((k) => compactObj({ keyword: k.keyword, rank: k.position, volume: k.volume, difficulty: k.difficulty })),
      }) : undefined,
    }),
    search_console_90_days: f ? compactObj({ clicks: f.clicks, impressions: f.impressions, ctr: f.ctr, position: f.position != null ? Number(f.position.toFixed(1)) : null, queries: f.queries, top_queries: f.top.slice(0, 10) }) : "no data",
    ga4_90_days: f ? { views: f.views, users: f.users, sessions: f.sessions, key_events: f.key_events } : "no data",
    service_page: p.target_service ? { links_to: p.target_service.title, url: p.target_service.url, anchor: p.target_service.anchor }
      : { links_to: null, suggested: p.suggested_service ? { title: p.suggested_service.title, url: p.suggested_service.url } : "no matching service page" },
    google_map: p.map ? compactObj({ embedded: p.map.embed, cid: p.map.cid, is_your_profile: p.map.matches_profile, place: p.map.place_name }) : "none",
    area: p.geo ? compactObj({ neighbourhood: p.geo.neighborhood, city: p.geo.city, zip: p.geo.zip, road_crossings: p.geo.road_crossings, landmarks: p.geo.landmarks, also_named: p.geo.neighborhoods.filter((x) => x !== p.geo?.neighborhood), read_by_claude: Boolean(p.geo.model) }) : "not read yet",
    links: { internal: p.internal_links, external: p.external_links, by_kind: kinds, list: p.links.slice(0, 30).map((l) => `${l.kind}: "${clip(l.anchor, 60) || "(no anchor)"}" → ${l.internal ? l.path || "/" : clip(l.url, 90)}`) },
    linked_from_posts: (a.inbound.get(path) ?? []).slice(0, 20).map((x) => ({ id: x.id, title: clip(x.title, 80), anchor: x.anchor })),
    issues: (a.issues.get(p.id) ?? []).map((k) => ({ issue: ISSUES[k].label, severity: ISSUES[k].severity, advice: ISSUES[k].advice })),
  });
}

async function blogData(ctx: NovaCtx) {
  const today = todayIn(ctx.client.timezone);
  const [blog, perf] = await Promise.all([
    loadBlog(ctx.admin, ctx.client.id),
    loadBlogPerformance(ctx.admin, ctx.client.id, { start: shiftDays(today, -90), end: today }),
  ]);
  if (blog.missing) throw new ToolError("Blog content needs a database update (migration 20261106000023) before posts can be read.");
  if (!blog.ok) throw new ToolError("Couldn't load the blog posts. Try again in a moment.");
  return { today, blog, perf, a: analyseBlog(blog.posts, perf, today) };
}

/** Light columns for Confirm cards. */
async function storedPosts(ctx: NovaCtx) {
  const { data, error } = await ctx.admin.from("blog_posts").select("id, url, published_date, keywords, geo, geo_cost, fetched_at").eq("client_id", ctx.client.id).limit(5000);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") throw new ToolError("Blog content needs a database update (migration 20261106000023) first.");
    throw new ToolError("Couldn't read the stored blog posts. Try again.");
  }
  return (data ?? []) as { id: string; url: string; published_date: string | null; keywords: { dfs_source?: string; dfs_at?: string } | null; geo: { model?: string | null } | null; geo_cost: number | null; fetched_at: string }[];
}

/**
 * Claude reading of posts: the per-post cost from this client's own reads, the run cap and the monthly budget left.
 * `pending`: stored posts not read yet (null = only newly found posts are read).
 */
async function claudeLine(ctx: NovaCtx, posts: Awaited<ReturnType<typeof storedPosts>>, pending: number | null) {
  if (!process.env.ANTHROPIC_API_KEY) return "Claude isn't configured, so places and keywords aren't read (posts are still stored).";
  const b = await claudeBudget(ctx.admin, ctx.client.id).catch(() => null);
  if (b && b.left <= 0) return `Reading posts with Claude is paused: this month's Claude budget (${usd(b.budget)}) is used up. Posts are still stored.`;
  const paid = posts.map((p) => Number(p.geo_cost ?? 0)).filter((c) => c > 0);
  const per = paid.length ? paid.reduce((s, c) => s + c, 0) / paid.length : GEO_EST;
  const cap = Math.min(RUN_COST_LIMIT, b?.left ?? RUN_COST_LIMIT);
  const which = pending == null ? "new posts are read"
    : pending ? `${plural(pending, "stored post")} not read yet (about ${usd(Math.min(pending * per, cap))}) plus any new or changed ones`
    : "every stored post is read already, so only new or changed posts cost anything";
  return `Claude (Haiku) reads places and keywords, about ${usd(per)} a post: ${which}. At most ${usd(cap)} this run${b ? `; counts toward the monthly Claude budget (${usd(b.left)} of ${usd(b.budget)} left)` : ""}.`;
}

const MODES = ["read", "keywords_new", "keywords_all", "crawler"] as const;

export const blogTools: NovaTool[] = [
  read({
    name: "get_blog_posts",
    description: "The client's blog posts: a summary, then posts with date, words, target keyword, neighbourhood, service-page link, map, Google clicks (90 days) and issues. Filter with search, month or issue; post (id, URL or title) returns one post in full.",
    schema: z.object({
      post: z.string().trim().min(1).max(500).optional().describe("one post in full detail: its id, URL or title"),
      search: z.string().trim().max(120).optional().describe("words in the title, keyword, neighbourhood, service or URL"),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("published in YYYY-MM"),
      issue: z.enum(ISSUE_KEYS).optional(),
      sort: z.enum(["newest", "oldest", "clicks", "impressions", "words"]).default("newest"),
      limit: z.number().int().min(1).max(50).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    async run(ctx, i) {
      const { today, blog, perf, a } = await blogData(ctx);
      const posts = blog.posts;
      if (!posts.length) return json({ posts: 0, note: "No blog posts read yet. An owner or admin can read the blog now, or the daily run reads it." });
      const perfOf = (p: BlogPost) => perf.get(pathOf(p.url));
      if (i.post) {
        const p = findPost(posts, i.post);
        const d = postDetail(p, a, perfOf(p)) as Record<string, unknown> & { links?: { list: string[] }; linked_from_posts?: unknown[] };
        return fit(d, () => {
          if (d.links && d.links.list.length > 8) { d.links.list = d.links.list.slice(0, 8); return true; }
          if (d.linked_from_posts && d.linked_from_posts.length > 5) { d.linked_from_posts = d.linked_from_posts.slice(0, 5); return true; }
          return false;
        });
      }

      const q = i.search?.toLowerCase();
      let list = posts.filter((p) => (!q || [p.title, p.url, p.keywords?.target, p.geo?.neighborhood, p.target_service?.title, ...(p.keywords?.secondary ?? [])].some((x) => x?.toLowerCase().includes(q)))
        && (!i.month || p.published_date?.startsWith(i.month)) && (!i.issue || a.issues.get(p.id)?.includes(i.issue)));
      const by = { newest: (x: BlogPost, y: BlogPost) => (y.published_date ?? "").localeCompare(x.published_date ?? ""), oldest: (x: BlogPost, y: BlogPost) => (x.published_date ?? "9").localeCompare(y.published_date ?? "9"),
        clicks: (x: BlogPost, y: BlogPost) => (perfOf(y)?.clicks ?? 0) - (perfOf(x)?.clicks ?? 0), impressions: (x: BlogPost, y: BlogPost) => (perfOf(y)?.impressions ?? 0) - (perfOf(x)?.impressions ?? 0),
        words: (x: BlogPost, y: BlogPost) => y.word_count - x.word_count }[i.sort];
      list = [...list].sort(by);
      const n = posts.length, pct = (k: number) => `${Math.round((k / n) * 100)}%`;
      const month = today.slice(0, 7), prev = shiftDays(`${month}-01`, -1).slice(0, 7);
      const issueCounts = Object.fromEntries(ISSUE_ORDER.map((k) => [k, posts.filter((p) => a.issues.get(p.id)?.includes(k)).length]).filter(([, c]) => Number(c) > 0));
      const filtered = Boolean(q || i.month || i.issue || i.offset);
      const out = {
        summary: filtered ? undefined : {
          posts: n, last_read: blog.lastFetched, source: posts[0]?.source === "sitemap" ? "sitemap / page HTML" : "WordPress",
          [`published_${month}`]: posts.filter((p) => p.published_date?.startsWith(month)).length, [`published_${prev}`]: posts.filter((p) => p.published_date?.startsWith(prev)).length,
          average_words: Math.round(posts.reduce((s, p) => s + p.word_count, 0) / n), link_a_service_page: pct(posts.filter((p) => p.target_service).length),
          map_to_your_profile: pct(posts.filter((p) => p.map?.matches_profile).length), places_read_by_claude: `${posts.filter((p) => p.geo?.model).length} of ${n}`,
          own_dataforseo_keyword_lists: posts.filter((p) => p.keywords?.dfs_source === "page").length,
          top_neighbourhoods: a.areas.slice(0, 6).map((x) => `${x.name} (${x.count})`),
          issues: issueCounts,
          google_data: perf.size ? "Search Console and GA4, last 90 days" : "Search Console not connected or no data",
        },
        issue_names: Object.fromEntries(Object.keys(issueCounts).map((k) => [k, ISSUES[k as IssueKey].label])),
        matched: list.length, offset: i.offset,
        posts: list.slice(i.offset, i.offset + i.limit).map((p) => {
          const f = perfOf(p);
          return compactObj({
            id: p.id, date: p.published_date, title: clip(p.title, 90), words: p.word_count, keyword: p.keywords?.target, area: p.geo?.neighborhood,
            service_page: p.target_service?.title ?? (p.suggested_service ? `none (suggested: ${p.suggested_service.title})` : "none"), map: mapState(p),
            clicks: f?.clicks ?? 0, impressions: f?.impressions ?? 0, position: f?.position != null ? Number(f.position.toFixed(1)) : undefined, views: f?.views || undefined,
            issues: a.issues.get(p.id),
          });
        }),
        more: list.length > i.offset + i.limit ? `${list.length - i.offset - i.limit} more: use offset ${i.offset + i.limit}` : undefined,
      };
      return fit(out, () => { if (out.posts.length <= 5) return false; out.posts = out.posts.slice(0, Math.ceil(out.posts.length / 2)); out.more = "shortened: use a smaller limit and offset"; return true; });
    },
    summary: (i) => (i.post ? "Read a blog post" : "Read blog posts"),
  }),

  write({
    name: "refresh_blog",
    description: "Blog page updates. read: read the blog now (new and changed posts; Claude reads places and keywords). keywords_new / keywords_all: paid DataForSEO ranking keywords for posts from the last 60 days / all posts. crawler: add posts found by DataForSEO's site crawler (starts a ~$0.03 crawl when none is recent).",
    schema: z.object({ mode: z.enum(MODES).default("read") }),
    async prepare(ctx, i) {
      const site = await websiteOf(ctx.admin, ctx.client.id);
      if (!site) return { error: "No website is known for this client yet: connect Search Console, Bing or Business Profile, or set the research target." };
      const posts = await storedPosts(ctx);

      if (i.mode === "read") {
        const pending = posts.filter((p) => !p.geo?.model).length;
        const last = posts.reduce<string | null>((m, p) => (!m || p.fetched_at > m ? p.fetched_at : m), null);
        return {
          title: `Read the blog on ${site} now`,
          detail: bullets([
            `Lists every post on ${site} and fetches new and changed ones (${plural(posts.length, "post")} stored now, last read ${ago(last)}).`,
            await claudeLine(ctx, posts, pending),
            "DataForSEO keywords already stored are matched to the posts (free).",
            "Posts no longer published on the site are removed from the Blog page.",
            "Takes up to about 4 minutes; if it stops early, ask again to continue.",
          ]),
          expectSeconds: !posts.length || pending > 20 ? 200 : 60,
        };
      }

      if (i.mode === "keywords_new" || i.mode === "keywords_all") {
        if (!dfsConfigured()) return { error: "DataForSEO isn't configured (Integrations), so keywords can't be fetched." };
        if (!posts.length) return { error: "No blog posts are stored yet: read the blog first (mode read)." };
        const all = i.mode === "keywords_all";
        // the same selection refreshPostKeywords() makes
        const newSince = new Date(Date.now() - KW_NEW_DAYS * DAY).toISOString().slice(0, 10);
        const staleBefore = Date.now() - KW_FRESH_DAYS * DAY;
        const due = posts.filter((p) => {
          const kw = p.keywords ?? {};
          const fresh = kw.dfs_source === "page" && typeof kw.dfs_at === "string" && Date.parse(kw.dfs_at) > staleBefore;
          return !fresh && (all || (p.published_date ?? "") >= newSince);
        }).length;
        const n = Math.min(due, KW_MAX_PAID);
        if (!n) return { error: all ? "Every post already has its own DataForSEO keyword list from the last 7 days: nothing to fetch." : "No post from the last 60 days needs keywords (each has its own list from the last 7 days). Use keywords_all for older posts." };
        const { left, cap } = await dfsLeftToday(ctx.admin, ctx.client.id);
        if (left < POST_KW_EST) return { error: `The DataForSEO daily budget is used up for this client (cap ${usd(cap)} a day). Try again tomorrow or raise the budget on Integrations.` };
        const affordable = Math.floor(left / POST_KW_EST);
        return {
          title: `Fetch DataForSEO keywords for ${plural(n, all ? "post" : "recent post")}`,
          detail: bullets([
            `Google ranking keywords with search volume for each post's own address: ${plural(n, "post")} ${all ? "without a list from the last 7 days" : "from the last 60 days without a list from the last 7 days"}${due > n ? ` (the first ${KW_MAX_PAID} of ${due})` : ""}.`,
            `Cost: about ${usd(POST_KW_EST)} a post, up to ${usd(keywordCost(n))} (DataForSEO).`,
            affordable < n ? `Today's budget covers about ${affordable} of them (${usd(left)} left for this client); it stops there and the rest can be fetched another day.` : `Within today's budget (${usd(left)} left for this client).`,
            "Runs for up to about 4 minutes; if it runs out of time, ask again to continue.",
          ]),
          expectSeconds: Math.min(220, 15 + Math.min(n, affordable) * 3),
        };
      }

      // crawler: what crawlBlogNow() will do, judged from stored state only (no DataForSEO call here)
      const { result, task } = await loadAudit(ctx.admin, ctx.client.id);
      const t = task?.data;
      if (t && t.status === "crawling" && Date.now() - Date.parse(t.startedAt) < CRAWL_STALE_MS) {
        return {
          title: "Check the site crawler and add the blog posts it found",
          detail: bullets([
            `A DataForSEO crawl of ${site} started ${ago(t.startedAt)} (up to ${t.maxPages} pages${t.crawled ? `, ${t.crawled} crawled at the last check` : ""}).`,
            "If it has finished, the crawled pages not stored yet are checked and blog posts among them are added (nothing is removed); if it's still running, nothing changes.",
            await claudeLine(ctx, posts, null),
          ]),
          expectSeconds: 90,
        };
      }
      const finished = result?.data.finishedAt;
      if (finished && Date.now() - Date.parse(finished) < CRAWL_RECENT_DAYS * DAY) {
        const stored = new Set(posts.map((p) => p.url));
        const host = site.replace(/^www\./, "");
        const candidates = new Set(result!.data.rows.filter((r) => r.status == null || r.status === 200).map((r) => r.url).filter((u) => {
          try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === host && x.pathname.replace(/\/+$/, "") !== "" && !stored.has(u); } catch { return false; }
        }));
        if (!candidates.size) return { error: `Every page from the site crawl of ${when(finished, ctx.client.timezone)} is already stored: nothing to add. A new crawl can be started once that one is ${CRAWL_RECENT_DAYS} days old.` };
        return {
          title: `Add blog posts found by the site crawler (${when(finished, ctx.client.timezone)})`,
          detail: bullets([
            `${plural(Math.min(candidates.size, 150), "crawled page")} not stored yet ${candidates.size > 150 ? `(the first 150 of ${candidates.size}) ` : ""}${candidates.size === 1 ? "is" : "are"} checked; only blog posts are added and nothing is removed.`,
            await claudeLine(ctx, posts, null),
            "Takes up to a few minutes.",
          ]),
          expectSeconds: 120,
        };
      }
      if (!dfsConfigured()) return { error: "DataForSEO isn't configured (Integrations), so a site crawl can't be started." };
      const est = auditEstimate(DEFAULT_AUDIT_PAGES);
      const { left } = await dfsLeftToday(ctx.admin, ctx.client.id);
      if (left < est) return { error: `Starting a crawl costs about ${usd(est)}, but only ${usd(left)} of today's DataForSEO budget is left for this client. Try again tomorrow or raise the budget on Integrations.` };
      return {
        title: `Start a DataForSEO crawl of ${site} to find missing blog posts`,
        detail: bullets([
          `Crawls up to ${DEFAULT_AUDIT_PAGES} pages (about ${usd(est)}, DataForSEO; ${usd(left)} of today's budget left). ${finished ? `The last crawl finished ${ago(finished)}.` : "There is no earlier crawl."}`,
          "The crawl takes a few minutes. Ask again afterwards to add the posts it finds; the daily run also picks them up.",
          "The same crawl also updates the Site Audit page.",
        ]),
        expectSeconds: 15,
      };
    },
    async execute(_x, i) {
      if (i.mode === "read") return fromAction(await syncBlogNow(), "The blog was read.", ["/blog"]);
      if (i.mode === "crawler") return fromAction(await crawlBlogNow(), "Done.", ["/blog"]);
      return fromAction(await fetchBlogKeywordsNow(i.mode === "keywords_all" ? "all" : "new"), "Keywords fetched.", ["/blog"]);
    },
  }),
];
