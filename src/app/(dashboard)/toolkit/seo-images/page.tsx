import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { BarList } from "@/components/charts/bar-list";
import { ResearchTable } from "@/components/research/research-table";
import { BackToToolkit, Card, day, FixList, type Fix } from "@/components/toolkit/bits";
import { ScanRun } from "@/components/toolkit/scan-run";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { loadScan, TK, type ImageAudit } from "@/lib/toolkit/site-scan";

export const maxDuration = 300;
const KB = (b: number | null) => (b == null ? null : Math.round(b / 1024));

/** Image audit. Thresholds from the claude-seo seo-images skill (MIT, github.com/AgricIDaniel/claude-seo): >200 KB warn, >500 KB critical. */
export default async function ImagesPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <><BackToToolkit /><TabHeader source={null} title="Image Audit" description="Every image on the website's key pages: file size, format, width/height (layout shift), lazy loading and alt text, with the fixes that matter most for speed and image search." guide={[
    { term: "Size", text: "Over 200 KB is flagged, over 500 KB is critical (read from the server's Content-Length; first 80 unique images)." },
    { term: "Format", text: "WebP or AVIF are typically 25-50% smaller than JPEG/PNG at the same quality. SVG is fine for logos and icons." },
    { term: "Layout shift", text: "An image without width and height attributes makes the page jump while it loads (CLS)." },
    { term: "Lazy loading", text: "Images below the fold should use loading=\"lazy\"; the first images on a page (likely the hero / LCP image) should not." },
    { term: "Method", text: "Adapted from the open-source claude-seo seo-images skill (MIT licence). Free: reads the client's own website." },
  ]} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Set the client's website so it can be scanned." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  const supabase = await createClient();
  const stored = await loadScan<ImageAudit>(supabase, client.id, TK.images);
  const top = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <p className="text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · scanned {day(stored?.fetchedAt)} · {stored?.data.pages ?? 0} pages · refreshed weekly</p>
      <ScanRun canEdit={canEdit} />
    </div>
  );
  if (!stored) return <>{header}{top}<EmptyState title="Not scanned yet" body="Run the free scan to audit the images on the key pages." /></>;
  const all = stored.data.images;
  // one row per unique file; page-specific attributes from its first use
  const uniq = new Map<string, (typeof all)[number] & { pagesUsed: number }>();
  for (const i of all) { const u = uniq.get(i.src); if (u) u.pagesUsed++; else uniq.set(i.src, { ...i, pagesUsed: 1 }); }
  const files = [...uniq.values()];
  const raster = files.filter((f) => f.format !== "svg");
  const big = files.filter((f) => (f.bytes ?? 0) > 200 * 1024), huge = files.filter((f) => (f.bytes ?? 0) > 500 * 1024);
  const oldFmt = raster.filter((f) => ["jpg", "png", "gif", "bmp", "tif", "tiff"].includes(f.format) && !f.inPicture);
  const noAlt = all.filter((i) => i.alt === null), emptyAlt = all.filter((i) => i.alt === "");
  const noDims = all.filter((i) => i.format !== "svg" && (!i.width || !i.height));
  const lazyHero = all.filter((i) => i.aboveFold && i.loading?.startsWith("lazy"));
  const notLazy = all.filter((i) => !i.aboveFold && !i.loading);
  const noSrcset = raster.filter((f) => !f.srcset && (f.bytes ?? 0) > 100 * 1024);
  const sized = files.filter((f) => f.bytes != null);
  const totalKb = Math.round(sized.reduce((s, f) => s + (f.bytes ?? 0), 0) / 1024);

  const fixes: Fix[] = [];
  if (huge.length) fixes.push({ prio: "Critical", issue: "Images over 500 KB", count: huge.length, fix: `Resize to the displayed size and compress (e.g. ${huge.slice(0, 2).map((h) => h.src.split("/").pop()).join(", ")}). Aim for under 200 KB, hero images under 300 KB.` });
  if (big.length - huge.length > 0) fixes.push({ prio: "High", issue: "Images 200-500 KB", count: big.length - huge.length, fix: "Compress and serve WebP; most should land at 50-150 KB." });
  if (oldFmt.length) fixes.push({ prio: "High", issue: "JPEG/PNG/GIF without a WebP/AVIF version", count: oldFmt.length, fix: "Turn on WebP conversion (e.g. the image optimisation plugin or CDN already used by WordPress) so browsers get WebP/AVIF." });
  if (noDims.length) fixes.push({ prio: "Medium", issue: "Images without width/height (layout shift)", count: noDims.length, fix: "Add width and height attributes (WordPress does this for images inserted through the editor; theme and page-builder images often miss them)." });
  if (lazyHero.length) fixes.push({ prio: "Medium", issue: "First images on a page are lazy-loaded", count: lazyHero.length, fix: "Exclude the hero/first image from lazy loading and add fetchpriority=\"high\"; lazy-loading it delays Largest Contentful Paint." });
  if (noAlt.length) fixes.push({ prio: "Medium", issue: "Images with no alt attribute", count: noAlt.length, fix: "Add short descriptive alt text (what the image shows, with the sign type and area where natural). Decorative images take alt=\"\"." });
  if (notLazy.length) fixes.push({ prio: "Low", issue: "Below-the-fold images loaded eagerly", count: notLazy.length, fix: "Add loading=\"lazy\" to images further down the page." });
  if (noSrcset.length) fixes.push({ prio: "Low", issue: "Large images without srcset", count: noSrcset.length, fix: "Serve responsive sizes (srcset) so phones don't download desktop-size files." });
  if (emptyAlt.length > all.length * 0.3) fixes.push({ prio: "Low", issue: "Many images with empty alt", count: emptyAlt.length, fix: "Empty alt is right for decoration only; content images (projects, signs) need a description." });

  const fmtCount = new Map<string, number>();
  for (const f of files) fmtCount.set(f.format, (fmtCount.get(f.format) ?? 0) + 1);

  return (
    <>
      {header}{top}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Unique images" value={String(files.length)} sub={`${all.length} placements on ${stored.data.pages} pages`} />
        <StatCard label="Over 200 KB" value={String(big.length)} sub={`${huge.length} over 500 KB · ${totalKb.toLocaleString()} KB measured`} tone={huge.length ? "bad" : big.length ? "warn" : "good"} />
        <StatCard label="Missing alt" value={String(noAlt.length)} sub={`${emptyAlt.length} empty alt (decorative)`} tone={noAlt.length ? "warn" : "good"} />
        <StatCard label="No width/height" value={String(noDims.length)} sub="cause layout shift" tone={noDims.length ? "warn" : "good"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Prioritised fixes"><FixList fixes={fixes} empty="Every image is compressed, modern-format, sized and described." /></Card>
        <div className="grid gap-4">
          <BarList title="Formats" valueLabel="files" items={[...fmtCount].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: label.toUpperCase(), value }))} />
          <BarList title="Heaviest files" valueLabel="KB" limit={6} items={sized.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 12).map((f) => ({ label: f.src.split("/").pop() ?? f.src, value: KB(f.bytes) ?? 0 }))} />
        </div>
      </div>
      <div className="mt-6">
        <ResearchTable title="Every image placement" csvName={`images-${cache.target.domain}`} searchKeys={["file", "page", "alt"]} initialSort={{ key: "kb", dir: "desc" }}
          rows={all.map((i) => ({ image: i.src, file: i.src.split("/").pop() ?? i.src, page: i.page, kb: KB(i.bytes), format: i.format.toUpperCase(), alt: i.alt === null ? "(missing)" : i.alt || "(empty)", dims: i.width && i.height ? `${i.width}x${i.height}` : "missing", loading: i.loading ?? "eager", srcset: i.srcset, position: i.aboveFold ? "top of page" : "below" }))}
          columns={[{ key: "image", label: "Image", type: "url" }, { key: "page", label: "Page", type: "url" }, { key: "kb", label: "KB", type: "int" }, { key: "format", label: "Format", type: "badge" }, { key: "alt", label: "Alt text" }, { key: "dims", label: "Width x height" }, { key: "loading", label: "Loading", type: "badge" }, { key: "srcset", label: "srcset", type: "bool" }, { key: "position", label: "Position" }]}
          facets={[{ key: "format", label: "Format" }, { key: "loading", label: "Loading" }, { key: "dims", label: "Dimensions" }]}
          presets={[{ label: "Missing alt", where: [{ key: "alt", op: "eq", value: "(missing)" }] }, { label: "Over 200 KB", where: [{ key: "kb", op: "gte", value: 200 }] }]} />
      </div>
    </>
  );
}
