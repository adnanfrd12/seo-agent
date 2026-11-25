import "server-only";
import { z } from "zod";
import { confirmImport } from "@/app/(dashboard)/imports/actions";
import { monthLabel, previousMonth, todayIn } from "@/lib/analytics/range";
import { bullets, plural, read, ToolError, write, type NovaCtx, type NovaTool } from "../../kit";
import { clip, compactObj, fit } from "./shared";

/**
 * Reporting: the monthly reports (/reports, nothing to edit there) and imported PDF reports (/imports): the figures
 * the AI read from each PDF, which the user accepts or rejects. Uploading a PDF happens on the Imports page only.
 */

type Report = { id: string; file_name: string; file_size: number; status: string; period_start: string | null; period_end: string | null; extraction: { title?: string; notes?: string[]; metric_count?: number } | null; error: string | null; created_at: string; confirmed_at: string | null };
type Metric = { id: string; original_label: string; value_text: string | null; value: number | null; unit: string | null; source_name: string | null; normalized_metric: string | null; confidence: string | null; page_number: number | null; review_status: string };

async function importOf(ctx: Pick<NovaCtx, "admin" | "client">, id: string): Promise<Report> {
  const { data, error } = await ctx.admin.from("imported_reports").select("id, file_name, file_size, status, period_start, period_end, extraction, error, created_at, confirmed_at").eq("client_id", ctx.client.id).eq("id", id).maybeSingle();
  if (error && (error.code === "42P01" || error.code === "PGRST205")) throw new ToolError("PDF imports need a database update (migration 20261021000011).");
  if (!data) throw new ToolError(`Import ${id} doesn't exist for this client. Read the imports first to get real ids.`);
  return data as Report;
}

async function metricsOf(ctx: Pick<NovaCtx, "admin" | "client">, importId: string): Promise<Metric[]> {
  const { data } = await ctx.admin.from("imported_report_metrics").select("id, original_label, value_text, value, unit, source_name, normalized_metric, confidence, page_number, review_status")
    .eq("client_id", ctx.client.id).eq("import_id", importId).order("page_number").limit(1000);
  return (data ?? []) as Metric[];
}

/** The Imports page's default for a figure nobody has ticked: accept it unless the extraction confidence is low. */
const suggested = (m: Metric): "accepted" | "rejected" => (m.review_status === "accepted" || m.review_status === "rejected" ? m.review_status : m.confidence === "low" ? "rejected" : "accepted");

/** The decision for every figure of an import (pure, so it can be checked without a database). */
export function decide(metrics: Metric[], a: { accept?: string[]; reject?: string[]; others: "suggested" | "accept" | "reject" }): Map<string, "accepted" | "rejected"> {
  const ids = new Set(metrics.map((m) => m.id));
  const acc = new Set(a.accept ?? []), rej = new Set(a.reject ?? []);
  const unknown = [...acc, ...rej].filter((id) => !ids.has(id));
  if (unknown.length) throw new ToolError(`${plural(unknown.length, "figure id")} ${unknown.length === 1 ? "isn't" : "aren't"} part of this import (${unknown.slice(0, 3).join(", ")}). Read the import's figures first.`);
  const both = [...acc].filter((id) => rej.has(id));
  if (both.length) throw new ToolError(`A figure can't be both accepted and rejected (${both.slice(0, 3).join(", ")}).`);
  return new Map(metrics.map((m) => [m.id, acc.has(m.id) ? "accepted" : rej.has(m.id) ? "rejected" : a.others === "accept" ? "accepted" : a.others === "reject" ? "rejected" : suggested(m)]));
}

const figure = (m: Metric) => `${clip(m.original_label, 70)} = ${clip(m.value_text ?? String(m.value ?? "—"), 40)}${m.source_name ? ` (${clip(m.source_name, 30)})` : ""}${m.confidence === "low" ? " · low confidence" : ""}`;

export const reportTools: NovaTool[] = [
  read({
    name: "get_reports_and_imports",
    description: "Reporting: links to the monthly reports and PDFs (last 12 complete months), and the imported PDF reports with their review status. Pass import_id for that import's extracted figures (ids for review_imported_figures).",
    schema: z.object({ import_id: z.uuid().optional() }),
    async run(ctx, i) {
      const months: string[] = [];
      let m = previousMonth(todayIn(ctx.client.timezone));
      for (let k = 0; k < 12; k++) { months.push(m); m = previousMonth(`${m}-15`); }
      const { data: reps, error } = await ctx.admin.from("imported_reports").select("id, file_name, file_size, status, period_start, period_end, extraction, error, created_at, confirmed_at").eq("client_id", ctx.client.id).order("created_at", { ascending: false }).limit(30);
      const list = (reps ?? []) as Report[];
      const counts = new Map<string, Record<string, number>>();
      if (list.length) {
        const { data: ms } = await ctx.admin.from("imported_report_metrics").select("import_id, review_status").eq("client_id", ctx.client.id).in("import_id", list.map((r) => r.id)).limit(10000);
        for (const x of (ms ?? []) as { import_id: string; review_status: string }[]) {
          const c = counts.get(x.import_id) ?? {};
          c[x.review_status] = (c[x.review_status] ?? 0) + 1;
          counts.set(x.import_id, c);
        }
      }
      const out: Record<string, unknown> = {
        monthly_reports: {
          page: "/reports",
          months: months.map((mm) => ({ month: mm, label: monthLabel(mm), view: `/report?month=${mm}`, full_pdf: `/api/report/pdf?month=${mm}&type=full`, executive_pdf: `/api/report/pdf?month=${mm}&type=executive` })),
          note: "Reports are built from the dashboard data; there are no report settings to change. Historical month-by-month totals: /history.",
        },
        imports: error ? "PDF imports aren't set up (database migration 20261021000011)." : list.map((r) => compactObj({
          id: r.id, file: r.file_name, uploaded: r.created_at.slice(0, 10), status: r.status === "extracted" ? "extracted: waiting for review" : r.status,
          title: r.extraction?.title, period: r.period_start && r.period_end ? `${r.period_start} to ${r.period_end}` : undefined,
          figures: counts.get(r.id), confirmed: r.confirmed_at?.slice(0, 10), error: r.error ? clip(r.error, 200) : undefined,
        })),
        how_to_import: "PDFs are uploaded on the Imports page (/imports); Nova can't upload files.",
      };
      if (i.import_id) {
        const r = await importOf(ctx, i.import_id);
        const ms = await metricsOf(ctx, r.id);
        const detail = {
          id: r.id, file: r.file_name, status: r.status, title: r.extraction?.title, period: r.period_start && r.period_end ? `${r.period_start} to ${r.period_end}` : "not stated in the document",
          notes: r.extraction?.notes?.length ? r.extraction.notes : undefined, can_review: r.status === "extracted",
          figures: ms.map((x) => compactObj({ id: x.id, label: clip(x.original_label, 100), value: x.value_text ?? x.value, source: x.source_name, maps_to: x.normalized_metric, confidence: x.confidence, page: x.page_number, review: x.review_status, suggested: x.review_status === "pending" ? suggested(x) : undefined })),
        };
        out.import = detail;
        delete out.monthly_reports;
        return fit(out, () => { if (detail.figures.length <= 20) return false; detail.figures = detail.figures.slice(0, Math.ceil(detail.figures.length * 0.7)); return true; });
      }
      return fit(out, () => false);
    },
    summary: (i) => (i.import_id ? "Read an imported report" : "Read reports and imports"),
  }),

  write({
    name: "review_imported_figures",
    description: "Accept or reject the figures extracted from an imported PDF report and confirm the review. Unlisted figures follow others (suggested = accept unless low confidence, as the Imports page pre-ticks them). Accepted figures become AI evidence; they never replace API data.",
    schema: z.object({
      import_id: z.uuid(),
      accept: z.array(z.uuid()).max(1000).optional(),
      reject: z.array(z.uuid()).max(1000).optional(),
      others: z.enum(["suggested", "accept", "reject"]).default("suggested"),
    }),
    async prepare(ctx, i) {
      const r = await importOf(ctx, i.import_id);
      if (r.status === "confirmed") return { error: `"${r.file_name}" was already reviewed and confirmed${r.confirmed_at ? ` on ${r.confirmed_at.slice(0, 10)}` : ""}; the Imports page doesn't allow changing it.` };
      if (r.status !== "extracted") return { error: `"${r.file_name}" has no figures to review (status: ${r.status}${r.error ? `, ${clip(r.error, 120)}` : ""}).` };
      const ms = await metricsOf(ctx, r.id);
      if (!ms.length) return { error: `No figures were extracted from "${r.file_name}".` };
      const d = decide(ms, i);
      const acc = ms.filter((m) => d.get(m.id) === "accepted"), rej = ms.filter((m) => d.get(m.id) === "rejected");
      return {
        title: `Confirm the review of "${clip(r.extraction?.title || r.file_name, 70)}": accept ${acc.length}, reject ${rej.length}`,
        detail: [
          acc.length ? `Accept:\n${bullets(acc.map(figure), 10)}` : "",
          rej.length ? `Reject:\n${bullets(rej.map(figure), 10)}` : "",
          "Accepted figures are used as evidence in AI analysis, labelled as imported; they never replace API data. After confirming, the review can't be changed on the Imports page.",
        ].filter(Boolean).join("\n"),
        input: { import_id: r.id, accept: acc.map((m) => m.id), reject: rej.map((m) => m.id), others: "suggested" },
      };
    },
    async execute(x, i) {
      const r = await importOf(x, i.import_id);
      if (r.status !== "extracted") return { ok: false, message: r.status === "confirmed" ? "This import was already confirmed meanwhile." : `This import can't be reviewed now (status: ${r.status}).` };
      const decisions: Record<string, "accepted" | "rejected"> = {};
      for (const id of i.accept ?? []) decisions[id] = "accepted";
      for (const id of i.reject ?? []) decisions[id] = "rejected";
      const res = await confirmImport(i.import_id, decisions);
      const a = (i.accept ?? []).length, j = (i.reject ?? []).length;
      return res.ok ? { ok: true, message: `Review of "${r.file_name}" confirmed: ${plural(a, "figure")} accepted, ${j} rejected.`, paths: ["/imports"] } : { ok: false, message: res.error };
    },
  }),
];

