"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "@/lib/revalidate";
import {
  BRAND_ASSET_KINDS, readBranding, saveBranding, uploadBrandAsset,
  type BrandAsset, type BrandAssetKind, type Branding, type BrandingErrors,
} from "@/lib/org/branding";
import { can, PermissionError, requireOrg } from "@/lib/org/permissions";

/**
 * Branding tab (Settings → Organization → Branding). Every action re-checks the session and the user's role in
 * the organization named by `orgId` on the server: any active member may view, owners and admins may change.
 */

export interface OrgProfile { name: string; website: string; email: string; phone: string; address: string }
export interface BrandingSettingsData { branding: Branding; canEdit: boolean; profile: OrgProfile }
type Fail = { ok: false; error: string; errors?: BrandingErrors };

const orgIdSchema = z.uuid();
const EDIT_DENIED = "Only organization owners and admins can change branding.";

function fail(e: unknown): Fail {
  unstable_rethrow(e); // a signed-out user is redirected to the sign-in page, not shown an error
  if (e instanceof PermissionError) return { ok: false, error: e.message };
  console.error("branding action failed:", e instanceof Error ? e.message : String(e));
  return { ok: false, error: "Something went wrong. Try again." };
}

function addressText(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  const r = a as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const cityLine = [s("city"), [s("region"), s("postal_code")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [s("line1"), s("line2"), cityLine, s("country")].filter(Boolean).join("\n");
}

/** Current branding (read fresh, not from the render cache), whether this user may edit it, and the organization's profile for "Use organization details". */
export async function loadBrandingSettings(orgId: string): Promise<{ ok: true; data: BrandingSettingsData } | Fail> {
  if (!orgIdSchema.safeParse(orgId).success) return { ok: false, error: "Choose an organization first." };
  try {
    const ctx = await requireOrg((r) => r !== null, orgId, "You're not a member of this organization.");
    const [branding, { data: org }] = await Promise.all([
      readBranding(ctx.admin, ctx.orgId),
      ctx.admin.from("organizations").select("name, website, email, phone, address").eq("id", ctx.orgId).maybeSingle(),
    ]);
    return {
      ok: true,
      data: {
        branding,
        canEdit: can.manageSettings(ctx.role),
        profile: { name: org?.name ?? "", website: org?.website ?? "", email: org?.email ?? "", phone: org?.phone ?? "", address: addressText(org?.address) },
      },
    };
  } catch (e) { return fail(e); }
}

/** Stores one image (logo, light/dark logo or favicon). It's only used once the branding is saved. */
export async function uploadBrandingAsset(orgId: string, kind: BrandAssetKind, form: FormData): Promise<{ ok: true; asset: BrandAsset } | Fail> {
  if (!orgIdSchema.safeParse(orgId).success) return { ok: false, error: "Choose an organization first." };
  if (!BRAND_ASSET_KINDS.includes(kind)) return { ok: false, error: "Unknown image slot." };
  try {
    const ctx = await requireOrg(can.manageSettings, orgId, EDIT_DENIED);
    const file = form.get("file");
    if (!(file instanceof Blob)) return { ok: false, error: "Choose an image file." };
    return await uploadBrandAsset(ctx.admin, ctx.orgId, kind, file);
  } catch (e) { return fail(e); }
}

/** Saves the branding (validated again here), audit-logs the change and refreshes the frame. */
export async function saveBrandingSettings(orgId: string, input: unknown): Promise<{ ok: true; branding: Branding } | Fail> {
  if (!orgIdSchema.safeParse(orgId).success) return { ok: false, error: "Choose an organization first." };
  try {
    const ctx = await requireOrg(can.manageSettings, orgId, EDIT_DENIED);
    const r = await saveBranding(ctx.admin, ctx.orgId, ctx.userId, input);
    if (r.ok) revalidatePath("/", "layout");
    return r;
  } catch (e) { return fail(e); }
}
