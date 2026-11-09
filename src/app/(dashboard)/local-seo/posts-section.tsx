import { Donut, MultiLine, StackedBars } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { Highlights } from "@/components/dashboard/highlights";
import { StatCard } from "@/components/dashboard/kpi-card";
import { PostsRefresh } from "@/components/research/posts-controls";
import { ResearchTable } from "@/components/research/research-table";
import { fmtInt } from "@/lib/analytics/format";
import { cat } from "@/lib/charts/colors";
import { GOOGLE_POST_LIMIT, type GbpPost, type LinkDest, type PostsRow } from "@/lib/dataforseo/gbp-posts";
import type { Highlight } from "@/lib/overview/highlights";

const DEST: { key: LinkDest; label: string; color: string }[] = [
  { key: "service", label: "Service page", color: "var(--positive)" },
  { key: "blog", label: "Blog post", color: "var(--cat-1)" },
  { key: "home", label: "Home page", color: "var(--warn)" },
  { key: "contact", label: "Contact page", color: "var(--cat-3)" },
  { key: "page", label: "Other own page", color: "var(--cat-5)" },
  { key: "google", label: "Offer on Google", color: "var(--cat-7)" },
  { key: "external", label: "External site", color: "var(--cat-other)" },
  { key: "none", label: "No link", color: "var(--negative)" },
];
const destLabel = (d: LinkDest) => DEST.find((x) => x.key === d)?.label ?? d;
const DAY = 86_400_000;
const daysSince = (posts: GbpPost[]) => {
  const d = posts.map((p) => p.date).filter(Boolean).sort().at(-1);
  return d ? Math.floor((Date.now() - Date.parse(d)) / DAY) : null;
};
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Business Profile posts: the client against its tracked competitors (read from storage only). */
export function PostsSection({ rows, canEdit }: { rows: PostsRow[]; canEdit: boolean }) {
  const waiting = rows.some((r) => r.status === "pending");
  const me = rows.find((r) => r.own);
  const mine = me?.posts ?? [];
  const label = (r: PostsRow) => (r.own ? `${r.name} (you)` : r.name);
  const control = <PostsRefresh canEdit={canEdit} waiting={waiting} hasData={rows.some((r) => r.fetchedAt)} businesses={Math.max(rows.length, 1)} />;
  if (!rows.some((r) => r.fetchedAt)) {
    return (
      <div className="space-y-3">
        {control}
        <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">{waiting ? "Collecting posts…" : "No posts loaded yet. They load automatically in the weekly run, or press the button above."}</p>
      </div>
    );
  }

  // posts per month, last 6 months
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const perMonth = [{
    key: "posts", label: "Posts", series: rows.map((r, i) => ({
      key: r.key, label: label(r), color: cat(i), data: months.map((m) => ({ date: `${m}-01`, value: r.posts.filter((p) => p.date?.startsWith(m)).length })),
    })),
  }];
  const destRows = rows.map((r) => ({ label: label(r), values: Object.fromEntries(DEST.map((d) => [d.key, r.posts.filter((p) => p.dest === d.key).length])), note: `${r.posts.length} posts` }));
  const ctas = new Map<string, number>();
  for (const r of rows) for (const p of r.posts) ctas.set(p.cta ?? "No button", (ctas.get(p.cta ?? "No button") ?? 0) + 1);
  const topLinked = new Map<string, number>();
  for (const p of mine) if (p.url) topLinked.set(p.path ?? p.url, (topLinked.get(p.path ?? p.url) ?? 0) + 1);
  const myDest = DEST.map((d) => ({ label: d.label, value: mine.filter((p) => p.dest === d.key).length, color: d.color })).filter((x) => x.value > 0);

  // issues (the client's own posts)
  const since = daysSince(mine);
  const noLink = mine.filter((p) => !p.url).length, home = mine.filter((p) => p.dest === "home").length, broken = mine.filter((p) => p.broken).length;
  const short = mine.filter((p) => p.words < 100).length, long = mine.filter((p) => p.chars > GOOGLE_POST_LIMIT).length, noImg = mine.filter((p) => !p.image).length;
  const service = mine.filter((p) => p.dest === "service").length;
  const issues: Highlight[] = [];
  if (me && (since == null || since >= 7)) issues.push({ tone: "bad", title: since == null ? "No posts found on the profile" : `No post in ${since} days`, detail: "Profiles that post every week look active to Google and to customers.", action: "Publish at least one post a week (an update, offer or project photo)." });
  if (broken) issues.push({ tone: "bad", title: `${broken} post${broken > 1 ? "s link" : " links"} to a broken page`, detail: "The button leads to a page that doesn't load.", action: "Edit the post and point the button to a working page." });
  if (noLink) issues.push({ tone: "bad", title: `${noLink} post${noLink > 1 ? "s have" : " has"} no link`, detail: "Without a button, readers can't go on to the website.", action: "Add a “Learn more” or “Call” button that leads to the matching service page." });
  if (home) issues.push({ tone: "info", title: `${home} post${home > 1 ? "s link" : " links"} to the home page`, detail: "A specific service page converts better and passes relevance to that page.", action: "Link each post to the service page it talks about." });
  if (mine.length && !service) issues.push({ tone: "info", title: "No post links to a service page", detail: "Posts currently send readers to blog posts or other pages.", action: "Alternate: link some posts straight to the service pages you want to rank." });
  if (short) issues.push({ tone: "info", title: `${short} post${short > 1 ? "s are" : " is"} under 100 words`, detail: "Short posts give Google little to understand.", action: "Write 100-250 words naming the service and the area." });
  if (long) issues.push({ tone: "bad", title: `${long} post${long > 1 ? "s are" : " is"} over Google's 1,500-character limit`, detail: "Google cuts or rejects longer text.", action: "Shorten the post to under 1,500 characters." });
  if (noImg) issues.push({ tone: "info", title: `${noImg} post${noImg > 1 ? "s have" : " has"} no image`, detail: "Posts with a photo get more attention.", action: "Add a real photo of the work to every post." });
  if (mine.length && !broken && !noLink && !noImg && since != null && since < 7) issues.push({ tone: "good", title: "Posting is healthy", detail: `Last post ${since} day${since === 1 ? "" : "s"} ago, every post has a working link and an image.` });

  const tableRows = rows.flatMap((r) => r.posts.map((p) => ({
    business: label(r), date: p.date, type: p.type, text: p.text, words: p.words, chars: p.chars, image: p.image ? "Image" : "No image", cta: p.cta ?? "No button",
    link: p.url, domain: p.domain ?? "—", where: destLabel(p.dest),
    path: p.path ?? "—", link_status: !p.url ? "No link" : p.broken ? `Broken${p.status ? ` (${p.status})` : ""}` : `OK (${p.status})`, google: p.googleUrl,
  })));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted">Newest {fmtInt(20)} Google Business Profile posts per business · {rows.find((r) => r.fetchedAt)?.fetchedAt?.slice(0, 10)} · refreshes weekly</p>
        {control}
      </div>
      <section aria-label="Posting summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Your posts loaded" value={fmtInt(mine.length)} />
        <StatCard label="Days since last post" value={since == null ? "—" : fmtInt(since)} tone={since == null || since >= 7 ? "bad" : "good"} />
        <StatCard label="Avg words" value={avg(mine.map((p) => p.words)) == null ? "—" : fmtInt(avg(mine.map((p) => p.words)))} />
        <StatCard label="Link to service page" value={fmtInt(service)} tone={service ? "good" : "warn"} />
        <StatCard label="Broken links" value={fmtInt(broken)} tone={broken ? "bad" : "good"} />
        <StatCard label="With image" value={`${mine.length - noImg}/${mine.length}`} tone={noImg ? "warn" : "good"} />
      </section>
      <Highlights items={issues} />
      <MultiLine title="Posts per month" sub="You vs tracked competitors, last 6 months" metrics={perMonth} />
      <div className="grid gap-4 lg:grid-cols-2">
        <StackedBars title="Where post links go" sub="Link destination per business" valueLabel="Posts" keys={DEST} rows={destRows} />
        {myDest.length > 0
          ? <Donut title="Your link destinations" sub="Where the button on your posts leads" items={myDest} center={fmtInt(mine.length)} centerLabel="posts" />
          : <BarList title="Your link destinations" valueLabel="Posts" items={[]} emptyText="No posts of yours loaded." />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BarList title="Average words per post" valueLabel="Words · posts" items={rows.map((r) => ({ label: label(r), value: avg(r.posts.map((p) => p.words)) ?? 0, detail: `${r.posts.length} posts` }))} />
        <BarList title="Days since last post" valueLabel="Days" emptyText="No dates." items={rows.map((r) => ({ label: label(r), value: daysSince(r.posts) ?? 0, detail: daysSince(r.posts) == null ? "no posts" : r.posts.length ? `${r.posts.length} posts` : undefined }))} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BarList title="Button (call to action) types" valueLabel="Posts, all businesses" items={[...ctas.entries()].sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l, value: v }))} />
        <BarList title="Your most linked pages" valueLabel="Posts" emptyText="Your posts have no links." items={[...topLinked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, v]) => ({ label: l, value: v }))} />
      </div>
      <ResearchTable title="All posts" rows={tableRows} searchKeys={["text", "link", "business"]} initialSort={{ key: "date", dir: "desc" }} pageSize={10} csvName="gbp-posts"
        columns={[
          { key: "business", label: "Business" }, { key: "date", label: "Date", type: "date" }, { key: "type", label: "Type", type: "badge" },
          { key: "text", label: "Post text" }, { key: "words", label: "Words", type: "int" }, { key: "chars", label: "Characters", type: "int" },
          { key: "image", label: "Image", type: "badge" }, { key: "cta", label: "Button", type: "badge" }, { key: "link", label: "Link", type: "url" },
          { key: "domain", label: "Domain" }, { key: "where", label: "Destination", type: "badge" }, { key: "path", label: "Path" },
          { key: "link_status", label: "Link check", type: "badge" }, { key: "google", label: "On Google", type: "open" },
        ]}
        facets={[{ key: "business", label: "Business" }, { key: "where", label: "Destination" }, { key: "link_status", label: "Link check" }]}
        presets={[{ label: "Under 100 words", where: [{ key: "words", op: "lte", value: 99 }] }, { label: "Over 1,500 characters", where: [{ key: "chars", op: "gte", value: GOOGLE_POST_LIMIT + 1 }] }]} />
    </div>
  );
}
