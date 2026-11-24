import { metaRoute } from "@/lib/compliance/webhooks";

// Facebook data deletion request callback (signed_request, META_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "facebook_pages", kind: "delete", secret: () => process.env.META_APP_SECRET?.trim() });
