import { metaRoute, orgSecrets } from "@/lib/compliance/webhooks";

// Facebook data deletion request callback (signed_request, verified with each organization's META_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "facebook_pages", kind: "delete", secrets: orgSecrets(["META_APP_SECRET"]) });
