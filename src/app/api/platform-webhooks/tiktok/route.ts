import { tiktokRoute } from "@/lib/compliance/webhooks";

// TikTok webhook (TikTok-Signature, TIKTOK_CLIENT_SECRET): authorization.removed deletes the account's data.
export const dynamic = "force-dynamic";
export const POST = tiktokRoute({ secret: () => process.env.TIKTOK_CLIENT_SECRET?.trim() });
