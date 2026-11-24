import type { Source } from "./types";

/** What each data source adds to quick wins (Data sources page and How it works). */
export const SOURCE_INFO: Record<Source, { adds: string; rules: string; example: string }> = {
  gsc: { adds: "Queries, pages, impressions, clicks, CTR, position, index status and reasons, canonicals, sitemaps, rich results", rules: "Title and meta rewrites, add the query to the title/H1, internal links, answer a question, merges, indexing fixes, CTR drops", example: "\"channel letters houston\" has 1,240 impressions at position 8.2" },
  ga4: { adds: "Sessions, engagement and leads (calls, forms, direction clicks) per landing page, channel, city and device", rules: "Landing-page and blog CTAs, mobile call buttons, form fixes, tracking gaps, AI-assistant traffic, promote a winner", example: "This page gets 210 organic visits but only 1 lead: add a call button" },
  gbp: { adds: "Business Profile calls, website clicks, direction requests and views by day; the searches that find the profile; reviews and replies (Google OAuth or Local Brand Manager)", rules: "Profile actions fell, searches the website doesn't cover, unanswered reviews", example: "6 reviews in the last 180 days have no reply" },
  bing: { adds: "Bing clicks, impressions and positions per query and page; crawl errors, 4xx/5xx and robots blocks", rules: "Bing striking-distance queries, pages Bing can't crawl", example: "\"led signs\" sits at position 7.4 on Bing with 180 impressions" },
  clarity: { adds: "Per-page sessions, rage clicks, dead clicks, quick backs, JavaScript errors and scroll depth", rules: "Fix what frustrates visitors on a page (with the GA4 lead rate for the gain)", example: "/contact had 9 quick backs and 4 dead clicks in 33 sessions" },
  youtube: { adds: "Channel subscribers, views and video statistics", rules: "Posting cadence, reconnect a broken login", example: "No video posted in the last 30 days" },
  facebook: { adds: "Page followers, posts and engagement", rules: "Posting cadence, reconnect a broken login", example: "2 posts in the last 30 days" },
  instagram: { adds: "Followers, posts, reach and engagement", rules: "Posting cadence, reconnect a broken login", example: "The best post had 48 interactions" },
  threads: { adds: "Followers, posts, views and engagement", rules: "Posting cadence, reconnect a broken login", example: "No posts in the last 30 days" },
  x: { adds: "Followers, posts and public metrics", rules: "Posting cadence, reconnect a broken login", example: "1 post in the last 30 days" },
  tiktok: { adds: "Followers, likes and video statistics", rules: "Posting cadence, reconnect a broken login", example: "3 videos in the last 30 days" },
  pinterest: { adds: "Followers, monthly views, pins and pin analytics", rules: "Posting cadence, reconnect a broken login", example: "No pins in the last 30 days" },
  linkedin: { adds: "Company page followers, post statistics and page views", rules: "Posting cadence, reconnect a broken login", example: "No company posts in the last 30 days" },
  dataforseo: { adds: "Monthly search volume and keyword difficulty, live Google results (who ranks above you, AI Overview, People Also Ask, map pack), competitor keywords you don't rank for, backlink gaps, Business Profile ratings", rules: "Keyword-gap pages, volume-weighted striking distance, SERP-feature wins, AI Overview, map pack, backlink gap, reviews vs competitors", example: "Competitors rank for \"dimension letters\" (18,100 searches/mo); you have no page for it" },
  crawl: { adds: "Titles, meta descriptions, H1s, headings, word count, internal links, schema and load time of each page (the portal's own crawler)", rules: "Duplicate titles, missing meta or H1, slow pages, links to broken pages", example: "The title is missing \"cost\" and \"near me\"" },
  seosignalx: { adds: "Saved SEOSignalX audits: E-E-A-T, semantic, speed, robots.txt and crawl optimization checks", rules: "Failed audit checks", example: "E-E-A-T score 64: 20 checks failed (author page, editorial guidelines…)" },
};
