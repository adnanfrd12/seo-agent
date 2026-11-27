import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuideDocInput } from "@/components/org/guides/pdf-document";
import { brandName, getBranding, logoSet } from "@/lib/org/branding";
import { allGuides, guideFor, guideIntro } from "@/lib/org/guides";
import { guideStatuses } from "./status";

/**
 * Everything a guide PDF shows about one organization: its name, public branding (logo, colour, white-label name)
 * and whether each integration is set up. Credential values are never read here (statuses come from the masked
 * listing, of which only "has a value" is used).
 */
export async function buildGuideInput(admin: SupabaseClient, orgId: string, which: string, opts: { appUrl?: string; now?: Date } = {}): Promise<GuideDocInput> {
  const [{ data: org, error }, branding, status] = await Promise.all([
    admin.from("organizations").select("name, timezone").eq("id", orgId).maybeSingle(),
    getBranding(orgId),
    guideStatuses(admin, orgId),
  ]);
  if (error || !org) throw new Error("Organization not found.");
  const appUrl = (opts.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const appName = brandName(branding);
  const ctx = { appUrl, appName, orgName: org.name as string };
  const all = which === "all";
  const one = all ? null : guideFor(which, ctx);
  if (!all && !one) throw new Error("No such guide.");
  return {
    mode: all ? "all" : "single",
    guides: all ? allGuides(ctx) : [one!],
    intro: all ? guideIntro(ctx) : undefined,
    brand: { appName, orgName: org.name as string, logo: await logoData(logoSet(branding)?.light ?? null), color: branding.colors.primary },
    status: all ? status : status[which] ? { [which]: status[which] } : {},
    generatedAt: opts.now ?? new Date(),
    timeZone: (org.timezone as string | null) ?? "UTC",
    appUrl,
  };
}

/** The organization's logo as a data: URI, read only from this project's public storage (else null: monogram). */
async function logoData(url: string | null): Promise<string | null> {
  const base = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "")}/storage/v1/object/public/`;
  if (!url || !base.startsWith("https://") || !url.startsWith(base)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length && bytes.length <= 1_500_000 ? `data:${type};base64,${bytes.toString("base64")}` : null;
  } catch {
    return null;
  }
}
