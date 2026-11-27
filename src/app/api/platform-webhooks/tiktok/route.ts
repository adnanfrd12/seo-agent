import { orgSecrets, tiktokRoute } from "@/lib/compliance/webhooks";

// TikTok webhook (TikTok-Signature, verified with each organization's TIKTOK_CLIENT_SECRET): authorization.removed deletes the account's data.
export const dynamic = "force-dynamic";
export const POST = tiktokRoute({ secrets: orgSecrets(["TIKTOK_CLIENT_SECRET"]) });
