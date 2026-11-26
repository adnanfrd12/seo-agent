"use server";

import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { deleteReviewReply, GbpApiError, updateReviewReply } from "@/lib/google/gbp";
import { locationIdOf } from "@/lib/google/gbp-view";
import { fetchVolumes, loadVolumes, staleKeywords } from "@/lib/google/keyword-volume";
import { GoogleAuthError } from "@/lib/google/oauth";
import { gbpAuth, googleTwin } from "@/lib/integrations/gbp-service";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string; reply?: string | null; repliedAt?: string | null } | { ok: false; error: string };

async function adminOnly() {
  const { user, client } = await getSession();
  if (!client || !["owner", "admin"].includes(client.role)) return null;
  return { user, client };
}

/** Why a Google call failed, in words an owner can act on. */
function explain(e: unknown): string {
  if (e instanceof GoogleAuthError) return "Google authorization expired. Reconnect Business Profile on the Integrations page.";
  if (e instanceof GbpApiError) {
    if (e.kind === "not_approved") return "Google hasn't approved Business Profile API access for this Google Cloud project yet, so replies can't be posted from here. Reply in Google Business Profile for now.";
    if (e.kind === "api_disabled") return "The My Business API isn't enabled in the Google Cloud project.";
    if (e.kind === "permission") return "The connected Google account can't manage this profile's reviews.";
    if (e.kind === "not_found") return "Google couldn't find this review (it may have been removed).";
    return `Google: ${e.message.slice(0, 200)}`;
  }
  return "Couldn't reach Google. Try again.";
}

/** The review (scoped to the active client) and the Google resource name to reply to. */
async function target(reviewId: string, clientId: string) {
  const admin = createAdminClient();
  const { data: review } = await admin.from("gbp_reviews").select("id, remote_id, resource_id, integration_resources(external_id)")
    .eq("id", reviewId).eq("client_id", clientId).maybeSingle();
  if (!review) return { error: "Review not found." } as const;
  const res = (Array.isArray(review.integration_resources) ? review.integration_resources[0] : review.integration_resources) as { external_id: string } | null;
  if (!res) return { error: "Review not found." } as const;
  const twin = await googleTwin(admin, clientId, locationIdOf(res.external_id));
  if (!twin.ok) {
    return { error: twin.reason === "no_connection"
      ? "Replying from here needs the direct Google Business Profile connection (Integrations)."
      : "This location isn't available in the connected Google account. Reconnect Business Profile or pick the location on the Integrations page." } as const;
  }
  return { admin, review, twin, name: `${twin.parent}/reviews/${review.remote_id}` } as const;
}

const replyInput = z.object({ reviewId: z.uuid(), comment: z.string().trim().min(1).max(4000) });

/** Posts or updates the owner's reply on Google (owners/admins), then stores it. */
export async function replyToReview(reviewId: string, comment: string): Promise<Result> {
  const who = await adminOnly();
  if (!who) return { ok: false, error: "Only owners and admins can reply to reviews." };
  const parsed = replyInput.safeParse({ reviewId, comment });
  if (!parsed.success) return { ok: false, error: "Write a reply (up to 4,000 characters)." };
  if (Buffer.byteLength(parsed.data.comment, "utf8") > 4096) return { ok: false, error: "Google allows replies up to 4,096 bytes." };
  const t = await target(parsed.data.reviewId, who.client.id);
  if ("error" in t) return { ok: false, error: t.error ?? "Review not found." };
  try {
    const auth = await gbpAuth(t.admin, t.twin.connectionId);
    const r = await updateReviewReply(auth, t.name, parsed.data.comment);
    const repliedAt = r.updateTime ?? new Date().toISOString();
    await t.admin.from("gbp_reviews").update({ reply_text: r.comment ?? parsed.data.comment, replied_at: repliedAt, reply_state: r.reviewReplyState ?? null, replied_by: who.user.id })
      .eq("id", t.review.id).eq("client_id", who.client.id);
    revalidatePath("/business-profile");
    return { ok: true, message: "Reply posted on Google.", reply: r.comment ?? parsed.data.comment, repliedAt };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function deleteReply(reviewId: string): Promise<Result> {
  const who = await adminOnly();
  if (!who) return { ok: false, error: "Only owners and admins can manage replies." };
  if (!z.uuid().safeParse(reviewId).success) return { ok: false, error: "Review not found." };
  const t = await target(reviewId, who.client.id);
  if ("error" in t) return { ok: false, error: t.error ?? "Review not found." };
  try {
    await deleteReviewReply(await gbpAuth(t.admin, t.twin.connectionId), t.name);
    await t.admin.from("gbp_reviews").update({ reply_text: null, replied_at: null, reply_state: null, replied_by: who.user.id })
      .eq("id", t.review.id).eq("client_id", who.client.id);
    revalidatePath("/business-profile");
    return { ok: true, message: "Reply deleted on Google.", reply: null, repliedAt: null };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** Fetches search volumes for the keywords that have none yet (or older than 30 days), within the DataForSEO budget. */
export async function fetchKeywordVolumes(keywords: string[]): Promise<Result> {
  const who = await adminOnly();
  if (!who) return { ok: false, error: "Only owners and admins can fetch search volumes." };
  const list = z.array(z.string().max(200)).max(2000).safeParse(keywords);
  if (!list.success) return { ok: false, error: "Invalid keyword list." };
  const admin = createAdminClient();
  // only keywords this client's Business Profile actually reported
  const { data: own } = await admin.from("gbp_keyword_metrics").select("keyword").eq("client_id", who.client.id).in("keyword", list.data.slice(0, 1000)).limit(5000);
  const allowed = [...new Set((own ?? []).map((r) => r.keyword as string))];
  const want = staleKeywords(allowed, await loadVolumes(admin, who.client.id));
  if (!want.length) return { ok: true, message: "Search volumes are already up to date." };
  try {
    const r = await fetchVolumes(admin, who.client.id, want, "manual");
    revalidatePath("/business-profile");
    return { ok: true, message: `Fetched search volume for ${r.fetched} keyword${r.fetched === 1 ? "" : "s"} ($${r.cost.toFixed(3)}).` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError ? e.message : e instanceof Error ? e.message.slice(0, 200) : "Couldn't fetch search volumes." };
  }
}
