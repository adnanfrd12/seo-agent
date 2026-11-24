import { metaRoute } from "@/lib/compliance/webhooks";

// Instagram Login deauthorize callback (signed_request, INSTAGRAM_APP_SECRET, else META_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "instagram", kind: "deauthorize", secret: () => process.env.INSTAGRAM_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() });
