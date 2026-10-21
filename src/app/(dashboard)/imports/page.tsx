import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Unavailable } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { first, type SearchParams } from "@/lib/analytics/url";
import { createClient } from "@/lib/supabase/server";
import { ReviewTable, UploadForm } from "./import-forms";

export const maxDuration = 300; // AI extraction runs inside the server action

type Report = { id: string; file_name: string; file_size: number; status: string; period_start: string | null; period_end: string | null; extraction: { title?: string; notes?: string[]; metric_count?: number } | null; error: string | null; created_at: string };
type Metric = { id: string; original_label: string; value_text: string | null; value: number | null; source_name: string | null; normalized_metric: string | null; confidence: string | null; page_number: number | null; review_status: string };

// imported metric -> where the same definition lives in API data (only directly comparable ones)
const COMPARABLE: Record<string, { provider: "ga4" | "gsc"; key: string; fmt: (n: number | null) => string }> = {
  ga4_sessions: { provider: "ga4", key: "sessions", fmt: fmtInt },
  ga4_users: { provider: "ga4", key: "users", fmt: fmtInt },
  ga4_key_events: { provider: "ga4", key: "key_events", fmt: fmtInt },
  ga4_engagement_rate: { provider: "ga4", key: "engagement_rate", fmt: fmtPercent },
  gsc_clicks: { provider: "gsc", key: "clicks", fmt: fmtInt },
  gsc_impressions: { provider: "gsc", key: "impressions", fmt: fmtInt },
  gsc_ctr: { provider: "gsc", key: "ctr", fmt: (n) => fmtPercent(n, 2) },
  gsc_position: { provider: "gsc", key: "position", fmt: fmtDecimal },
};

export default async function ImportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const canEdit = ["owner", "admin"].includes(client.role);
  const supabase = await createClient();
  const { data: reports, error } = await supabase.from("imported_reports").select("*").eq("client_id", client.id).order("created_at", { ascending: false }).limit(30);
  const selectedId = first(sp.id) ?? (reports?.[0] as Report | undefined)?.id;
  const selected = ((reports ?? []) as Report[]).find((r) => r.id === selectedId);
  const { data: metrics } = selected
    ? await supabase.from("imported_report_metrics").select("*").eq("import_id", selected.id).order("page_number")
    : { data: [] };

  // side-by-side with API data, only for the same period and an equivalent definition
  let api: { ga4?: Record<string, unknown>; gsc?: Record<string, unknown> } | null = null;
  if (selected?.status === "confirmed" && selected.period_start && selected.period_end) {
    const { data } = await supabase.rpc("get_seo_overview", { p_client_id: client.id, p_start: selected.period_start, p_end: selected.period_end });
    const o = data as { ga4?: { current?: Record<string, unknown> }; gsc?: { current?: Record<string, unknown> } } | null;
    api = { ga4: o?.ga4?.current, gsc: o?.gsc?.current };
  }
  const comparable = ((metrics ?? []) as Metric[]).filter((m) => m.review_status === "accepted" && m.normalized_metric && COMPARABLE[m.normalized_metric]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="Import PDF Reports" description="Upload an existing SEO report. Figures are extracted for your review and kept separately from live API data." />
      {error ? <Unavailable title="Database update needed" body="Apply migration 20261021000011 in Supabase to enable report imports." />
        : !process.env.ANTHROPIC_API_KEY ? <Unavailable title="AI isn't configured" body="Report extraction needs ANTHROPIC_API_KEY." />
        : canEdit ? <UploadForm /> : <p className="text-sm text-muted">Only owners and admins can import reports.</p>}

      {(reports ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Imported reports</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {((reports ?? []) as Report[]).map((r) => (
              <li key={r.id}>
                <Link href={`/imports?id=${r.id}`} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-surface-muted ${r.id === selected?.id ? "bg-surface-muted" : ""}`}>
                  <span className="font-medium">{r.file_name}</span>
                  <span className="text-xs text-muted">{(r.file_size / 1024 / 1024).toFixed(1)} MB · {new Date(r.created_at).toLocaleDateString()}</span>
                  <span className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${r.status === "failed" ? "bg-negative/10 text-negative" : r.status === "confirmed" ? "bg-positive/10 text-positive" : "bg-surface-muted"}`}>{r.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{selected.extraction?.title || selected.file_name}</h2>
            <p className="text-sm text-muted">
              Reporting period: {selected.period_start && selected.period_end ? `${selected.period_start} → ${selected.period_end}` : "not stated in the document"}
              {" · "}{selected.extraction?.metric_count ?? (metrics ?? []).length} figures found
            </p>
            {selected.error && <p className="mt-1 text-sm text-negative">{selected.error}</p>}
          </div>
          {(selected.extraction?.notes?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-sm">
              <p className="font-semibold">Extraction notes</p>
              <ul className="mt-1 list-disc pl-5 text-muted">{selected.extraction!.notes!.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
          {(metrics ?? []).length > 0 && <ReviewTable importId={selected.id} metrics={(metrics ?? []) as Metric[]} confirmed={selected.status === "confirmed"} />}

          {selected.status === "confirmed" && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-semibold">Compare with live analytics</h3>
              {!api ? (
                <p className="mt-1 text-sm text-muted">Comparison needs a reporting period stated in the document.</p>
              ) : comparable.length === 0 ? (
                <p className="mt-1 text-sm text-muted">No accepted figures map to a metric with the same definition as the API data.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-1">Metric</th><th className="py-1 text-right">Imported report</th><th className="py-1 text-right">API ({selected.period_start} → {selected.period_end})</th></tr></thead>
                  <tbody>
                    {comparable.map((m) => {
                      const c = COMPARABLE[m.normalized_metric!];
                      const src = c.provider === "ga4" ? api!.ga4 : api!.gsc;
                      return (
                        <tr key={m.id} className="border-t border-border">
                          <td className="py-1.5">{m.original_label}</td>
                          <td className="py-1.5 text-right tabular-nums">{m.value_text}</td>
                          <td className="py-1.5 text-right tabular-nums">{src?.has_data ? c.fmt(toNum(src[c.key])) : "no API data for this period"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-muted">Other tools may define metrics differently (e.g. sessions vs visits, filters, time zones). Treat differences as a prompt to check definitions, not as errors.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
