import { metaRoute, orgSecrets } from "@/lib/compliance/webhooks";

// Instagram data deletion request callback (signed_request, verified with each organization's INSTAGRAM_APP_SECRET, else META_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "instagram", kind: "delete", secrets: orgSecrets(["INSTAGRAM_APP_SECRET", "META_APP_SECRET"]) });
