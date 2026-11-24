import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SITE } from "@/config/platforms";
import { A, LEGAL_UPDATED, PublicHeader } from "@/components/legal/legal-page";
import { SiteFooter } from "@/components/legal/site-footer";
import { CODE_RE } from "@/lib/compliance/signatures";
import { allowLookup } from "@/lib/compliance/rate-limit";

export const metadata: Metadata = {
  title: "Deletion request status · SEO Insights",
  description: "Check the status of a data deletion request sent to SEO Insights with the confirmation code you received.",
  alternates: { canonical: "/data-deletion/status" },
};
export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

async function lookup(code: string): Promise<{ text: string; tone: "ok" | "info" | "bad" }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!allowLookup(ip)) return { tone: "bad", text: "Too many lookups. Please wait a minute and try again." };
  const clean = code.trim().toUpperCase();
  const notFound = { tone: "bad" as const, text: `We couldn't find that code. Email ${SITE.email}` };
  if (!CODE_RE.test(clean)) return notFound;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { findRequest } = await import("@/lib/compliance/store");
    const r = await findRequest(createAdminClient(), clean);
    if (!r) return notFound;
    if (r.status === "completed" && r.completed_at) return { tone: "ok", text: `Data deleted on ${day(r.completed_at)}.` };
    if (r.status === "not_found") return { tone: "ok", text: `Request received on ${day(r.created_at)}. We hold no data for that account, so there was nothing to delete.` };
    return { tone: "info", text: `Request received on ${day(r.created_at)}.` };
  } catch {
    return { tone: "bad", text: `The status can't be checked right now. Try again later or email ${SITE.email}` };
  }
}

export default async function DeletionStatusPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const raw = (await searchParams).code;
  const code = typeof raw === "string" ? raw.slice(0, 40) : "";
  const result = code ? await lookup(code) : null;
  const tone = { ok: "border-[#BBE5C8] bg-[#F0FAF3] text-[#14532D]", info: "border-[#F3E3D6] bg-[#FFF8F2] text-[#6b4a32]", bad: "border-[#F7D4CC] bg-[#FDF1EE] text-[#9F1239]" };
  return (
    <div className="flex min-h-dvh flex-col bg-[#FBF8F5] text-[#1f1f25]">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 lg:py-16">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">Your data</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Deletion request status</h1>
        <p className="mt-2 text-sm text-[#6b6b76]">Last updated: {LEGAL_UPDATED}</p>
        <p className="mt-6 text-[15px] leading-7 text-[#3a3a42]">Enter the confirmation code you received (for example from Facebook, Instagram or Threads after asking for your data to be deleted).</p>
        <form method="get" action="/data-deletion/status" className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="code" className="sr-only">Confirmation code</label>
          <input id="code" name="code" defaultValue={code} required maxLength={40} autoComplete="off" spellCheck={false} placeholder="Confirmation code"
            className="min-w-0 flex-1 rounded-xl border border-[#E7E2DD] bg-white px-4 py-3 font-mono text-[15px] uppercase tracking-wider outline-none focus-visible:border-[#F26A1B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/20" />
          <button type="submit" className="rounded-xl bg-gradient-to-r from-[#F26A1B] to-[#E8452C] px-6 py-3 font-semibold text-white outline-none focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30">Check status</button>
        </form>
        <div aria-live="polite">
          {result && <p role="status" className={`mt-5 rounded-xl border p-4 text-[15px] ${tone[result.tone]}`}>{result.text}</p>}
        </div>
        <p className="mt-8 text-[15px] leading-7 text-[#3a3a42]">How deletion works: <Link href="/data-deletion" className={A}>Data Deletion</Link> · <Link href="/privacy" className={A}>Privacy Policy</Link></p>
      </main>
      <SiteFooter />
    </div>
  );
}
