import { BarList, Funnel, LineChart, Scatter, Treemap, WhatChanged } from "@/components/ga4x/charts";
import { C, channelColor, fmt } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Missing, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { group, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { labels } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/ecommerce";

export default async function EcommercePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} users title="E-commerce" description="Sales, orders, products and the path from product view to purchase.">
      {({ g, wins }) => {
        const on = g.meta.ecommerce;
        const cur = (c: typeof g.ecom) => c.filter(g.inCur), prv = (c: typeof g.ecom) => c.filter(g.inPrev);
        const rev = sum(cur(g.ecom), (x) => Number(x.purchaseRevenue)), revP = sum(prv(g.ecom), (x) => Number(x.purchaseRevenue));
        const ord = sum(cur(g.ecom), (x) => Number(x.ecommercePurchases)), ordP = sum(prv(g.ecom), (x) => Number(x.ecommercePurchases));
        const first = sum(cur(g.ecom), (x) => Number(x.firstTimePurchasers));
        const users = g.users?.totals.cur.activeUsers ?? 0;
        const items = [...group(cur(g.items), (x) => String(x.itemName))].map(([k, v]) => { const vw = sum(v, (x) => Number(x.itemsViewed)), a = sum(v, (x) => Number(x.itemsAddedToCart)), p = sum(v, (x) => Number(x.itemsPurchased)); return { n: k, v: vw, a, co: sum(v, (x) => Number(x.itemsCheckedOut)), p, rev: sum(v, (x) => Number(x.itemRevenue)), c2v: vw ? a / vw : null, p2v: vw ? p / vw : null }; }).sort((a, b) => b.rev - a.rev);
        const byCh = [...group(cur(g.ecom), (x) => String(x.sessionDefaultChannelGroup))].map(([k, v]) => ({ k, rev: sum(v, (x) => Number(x.purchaseRevenue)) })).sort((a, b) => b.rev - a.rev);
        const byChP = [...group(prv(g.ecom), (x) => String(x.sessionDefaultChannelGroup))].map(([k, v]) => ({ k, rev: sum(v, (x) => Number(x.purchaseRevenue)) }));
        const ev = (n: string) => sum(g.events.filter((x) => g.inCur(x) && x.eventName === n), (x) => Number(x.eventCount));
        const steps: [string, number][] = ["view_item", "add_to_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase"].map((e) => [e, ev(e)]);
        const coupons = [...group(cur(g.coupons), (x) => String(x.orderCoupon))].filter(([k]) => k && k !== "(not set)").map(([k, v]) => ({ item: `Coupon ${k}`, orders: sum(v, (x) => Number(x.transactions)), revenue: sum(v, (x) => Number(x.purchaseRevenue)) }));
        const rf = cur(g.refunds);
        const extra = [{ item: "Refunds", orders: null, revenue: -sum(rf, (x) => Number(x.refundAmount)) }, { item: "Shipping collected", orders: null, revenue: sum(rf, (x) => Number(x.shippingAmount)) }, { item: "Tax collected", orders: null, revenue: sum(rf, (x) => Number(x.taxAmount)) }];
        const cur$ = g.meta.currency ?? "USD";
        const why = "This property sends no e-commerce events (view_item, add_to_cart, begin_checkout, purchase), so GA4 has no sales, orders or products to report.";
        const fix = "If the business sells online, send GA4's e-commerce events from the shop (most platforms such as Shopify, WooCommerce and Square do it once GA4 is connected in their settings). This screen fills in on the next sync after the first purchase event. For a service business without online sales, nothing needs to change: leads are on the Leads screens.";
        const miss = <Missing why={why} fix={fix} />;
        const money = (v: number) => fmt("money", v, cur$);
        return (
          <>
            {!on && <Card title="No online store data" sub="This property sends no e-commerce events, so every number on this screen shows 000. It fills in automatically when view_item, add_to_cart, begin_checkout and purchase events exist."><Missing why={why} fix={fix} /></Card>}
            <div className={on ? "" : "mt-4"}><Kpis>
              <Kpi label="Sales" tech="Purchase revenue" value={on ? money(rev) : "000"} cur={on ? rev : undefined} prev={on ? revP : undefined} missing={on ? undefined : why} />
              <Kpi label="Orders" tech="Purchases" value={on ? fmt("int", ord) : "000"} cur={on ? ord : undefined} prev={on ? ordP : undefined} missing={on ? undefined : why} />
              <Kpi label="Average order" tech="Average order value" value={on && ord ? money(rev / ord) : "000"} missing={on ? undefined : why} />
              <Kpi label="Visitors who bought" tech="Purchase rate" value={on && users ? fmt("pct", ord / users) : "000"} missing={on ? undefined : why} />
              <Kpi label="First-time buyers" tech="First-time purchasers" value={on ? fmt("int", first) : "000"} missing={on ? undefined : why} />
            </Kpis></div>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="From product view to purchase" tech="Purchase funnel" sub="Event counts at each step of the shop (view_item → purchase)." span={4}>{on ? <Funnel steps={steps} mono /> : miss}</Card>
              <Card title="Sales by source" tech="Revenue by channel" span={8}>{on ? <BarList rows={byCh.map((r, i) => ({ label: r.k, value: r.rev, color: channelColor(r.k, i) }))} f="money" /> : miss}</Card>
              <Card title="Sales each day" tech="Daily revenue" span={8}>{on ? <LineChart id="ecom-rev" f="money" labels={labels(g)} series={[{ name: "This period", values: g.daily(g.ecom, (x) => Number(x.purchaseRevenue)), color: C[2], area: true }, { name: "Previous period", values: g.daily(g.ecom, (x) => Number(x.purchaseRevenue), true), color: C[2], dash: true }]} /> : miss}</Card>
              <Card title="Sales by product" tech="Revenue by product" span={4}>{on ? <Treemap items={items.slice(0, 12).map((r, i) => ({ label: r.n, value: r.rev, color: C[i % C.length] }))} f="money" /> : miss}</Card>
              <Card title="Products: views vs how often they're bought" tech="Products: views vs purchase rate" sub="Bubble = revenue." span={6}>{on ? <Scatter points={items.filter((r) => r.v).map((r) => ({ x: r.v, y: r.p2v ?? 0, s: r.rev, label: r.n, show: true }))} xLabel="Item views (log scale)" yLabel="Purchase-to-view" logX /> : miss}</Card>
              <Card title="What caused the change in sales" tech="What changed revenue" sub="By channel." span={6}>{on ? <WhatChanged id="ecom-wf" unit="sales" f="money" start={revP} items={[...new Set([...byCh.map((r) => r.k), ...byChP.map((r) => r.k)])].map((k) => ({ label: k, value: (byCh.find((r) => r.k === k)?.rev ?? 0) - (byChP.find((r) => r.k === k)?.rev ?? 0) }))} /> : miss}</Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Products sold" tech="Products" sub="itemName with item views, add-to-carts, purchases and revenue." span={8}>
                {on ? <Table rows={items} cols={[{ k: "n", label: "Item name" }, { k: "v", label: "Viewed", num: true }, { k: "a", label: "Added to cart", num: true }, { k: "p", label: "Purchased", num: true }, { k: "rev", label: "Item revenue", num: true, f: "money", bar: C[2] }, { k: "c2v", label: "Cart-to-view", num: true, f: "pct" }, { k: "p2v", label: "Purchase-to-view", num: true, f: "pct" }]} /> : miss}
              </Card>
              <Card title="Coupons and refunds" tech="Coupons and refunds" span={4}>
                {on ? <Table rows={[...coupons, ...extra]} cols={[{ k: "item", label: "Item" }, { k: "orders", label: "Orders", num: true }, { k: "revenue", label: "Revenue", num: true, f: "money" }]} /> : miss}
              </Card>
            </Grid>
            <ScreenTasks screen="E-commerce" wins={forScreen(wins, "ecom")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
