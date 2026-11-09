import { CheckCircle2, CircleX } from "lucide-react";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { BackToToolkit, Card, day } from "@/components/toolkit/bits";
import { ScanRun } from "@/components/toolkit/scan-run";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { loadScan, TK } from "@/lib/toolkit/site-scan";

export const maxDuration = 300;
type E = { checkedAt: string; wooApi: boolean; wooApiStatus: number | null; productSchema: boolean; wooMarkup: boolean; pagesChecked: number };

/** E-commerce SEO applies only with a product catalogue (claude-seo seo-ecommerce skill, MIT, github.com/AgricIDaniel/claude-seo). */
export default async function EcommercePage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <><BackToToolkit /><TabHeader source={null} title="E-commerce SEO" description="Product and category page SEO (Product schema, faceted navigation, product feeds). It only applies when the website sells products online, so the scan checks for a product catalogue first." /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Set the client's website so it can be scanned." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  const supabase = await createClient();
  const stored = await loadScan<E>(supabase, client.id, TK.ecommerce);
  if (!stored) return <>{header}<div className="mb-4"><ScanRun canEdit={canEdit} /></div><EmptyState title="Not checked yet" body="Run the free scan to check for a product catalogue." /></>;
  const e = stored.data;
  const shop = e.wooApi || e.productSchema;
  const rows = [
    { ok: e.wooApi, label: "WooCommerce product API", detail: e.wooApi ? "returns products" : `no products (answered ${e.wooApiStatus ?? "nothing"})` },
    { ok: e.productSchema, label: "Product / Offer structured data", detail: `${e.productSchema ? "found" : "not found"} on ${e.pagesChecked} key pages` },
    { ok: e.wooMarkup, label: "WooCommerce shop markup (cart, add-to-cart)", detail: e.wooMarkup ? "found" : "not found" },
  ];
  return (
    <>
      {header}
      <p className="mb-4 text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · checked {day(e.checkedAt)}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={shop ? "Product catalogue detected" : "Not applicable: no product catalogue detected"}>
          <p className="text-sm text-secondary">{shop
            ? "The site exposes products, so product-page SEO applies. Use the Page Analyzer on product URLs and the Technical SEO page for schema checks."
            : `${cache.target.domain} is a lead-generation service site (quotes, calls, visits), not an online shop. Product schema, category facets and merchant feeds don't apply; the Local SEO, Service x Area Planner and Technical SEO tools cover what matters here.`}</p>
        </Card>
        <Card title="What was checked">
          <ul className="space-y-2 text-sm">{rows.map((r) => (
            <li key={r.label} className="flex items-start gap-2">{r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-muted" />}<span><span className="font-medium">{r.label}</span> <span className="text-muted">· {r.detail}</span></span></li>
          ))}</ul>
        </Card>
      </div>
    </>
  );
}
