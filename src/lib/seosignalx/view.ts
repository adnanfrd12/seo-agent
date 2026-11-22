import "server-only";
import { after } from "next/server";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStale, loadBundle, refreshBundle, sxConfigured, type AuditKey, type SxAudit, type SxBundle } from "./mcp";

/**
 * Data for an SEOSignalX page: the stored bundle for the selected client. The first visit reads SEOSignalX
 * right away; after that a bundle older than 6 hours is refreshed in the background (the page shows the
 * stored one meanwhile), so SEOSignalX data stays current without a button.
 */
export async function sxPage(): Promise<{ clientName: string; configured: boolean; bundle: SxBundle | null } | null> {
  const { client } = await getSession();
  if (!client) return null;
  if (!sxConfigured()) return { clientName: client.name, configured: false, bundle: null };
  const admin = createAdminClient();
  const { bundle, fetchedAt } = await loadBundle(admin, client.id);
  if (!bundle) return { clientName: client.name, configured: true, bundle: await refreshBundle(admin, client.id) };
  if (isStale(fetchedAt)) {
    const id = client.id;
    after(() => refreshBundle(createAdminClient(), id).then(() => undefined, () => undefined));
  }
  return { clientName: client.name, configured: true, bundle };
}

export const audit = <T,>(b: SxBundle | null, k: AuditKey) => (b?.audits[k] as SxAudit<T> | undefined) ?? null;

type Check = { status?: string };
type Section = { passed?: number; total?: number; checks?: Check[] };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Score and one-line summary per audit, as on the SEOSignalX dashboard cards. */
export function scores(b: SxBundle | null) {
  const out: Partial<Record<AuditKey, { score: number | null; summary: string }>> = {};
  const eeat = audit<{ rating?: string; sections?: Section[] }>(b, "eeat")?.result;
  if (eeat?.sections) {
    // as on SEOSignalX's E-E-A-T page: passed checks out of all checks
    // (from each section's own totals, which stay complete even when SEOSignalX truncates the check list)
    const passed = sum(eeat.sections.map((s) => s.passed ?? (s.checks ?? []).filter((c) => c.status === "pass").length));
    const total = sum(eeat.sections.map((s) => s.total ?? (s.checks ?? []).length));
    out.eeat = { score: total ? Math.round((passed / total) * 100) : null, summary: `${passed}/${total} trust signals passed${eeat.rating ? ` · ${eeat.rating}` : ""}` };
  }
  const sem = audit<{ seoScore?: number; wordCount?: number; headingHierarchy?: unknown[] }>(b, "semantic")?.result;
  if (sem) out.semantic = { score: sem.seoScore ?? null, summary: `${((sem.wordCount ?? 0) / 1000).toFixed(1)}K words, ${sem.headingHierarchy?.length ?? 0} headings` };
  const speed = audit<{ mobile?: { score?: number | null; available?: boolean }; desktop?: { score?: number | null }; sections?: Section[] }>(b, "speed")?.result;
  if (speed) {
    const checks = (speed.sections ?? []).flatMap((s) => s.checks ?? []).filter((c) => c.status === "pass" || c.status === "fail");
    const passed = checks.filter((c) => c.status === "pass").length;
    const lab = speed.mobile?.score ?? speed.desktop?.score ?? null;
    out.speed = { score: lab ?? (checks.length ? Math.round((passed / checks.length) * 100) : null), summary: lab != null ? "PageSpeed score" : `${passed}/${checks.length} speed checks passed` };
  }
  const robots = audit<{ passed?: number; totalChecks?: number; notFound?: number; sitemaps?: string[] }>(b, "robots")?.result;
  if (robots) {
    // as on SEOSignalX's Robots.txt page ("robots.txt health"): passed checks out of all checks
    out.robots = { score: robots.totalChecks ? Math.round(((robots.passed ?? 0) / robots.totalChecks) * 100) : null, summary: `${robots.passed ?? 0} of ${robots.totalChecks ?? 0} checks passed${robots.sitemaps?.length ? " · sitemap declared" : ""}` };
  }
  const crawl = audit<{ clean?: number; totalChecks?: number }>(b, "crawlOptimization")?.result;
  if (crawl) out.crawlOptimization = { score: crawl.totalChecks ? Math.round(((crawl.clean ?? 0) / crawl.totalChecks) * 100) : null, summary: `${crawl.clean ?? 0}/${crawl.totalChecks ?? 0} crawl checks clean` };
  const vals = Object.values(out).map((x) => x?.score).filter((x): x is number => x != null);
  return { per: out, overall: vals.length ? Math.round(sum(vals) / vals.length) : null, done: vals.length };
}
