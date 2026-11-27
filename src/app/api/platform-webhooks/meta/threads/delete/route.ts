import { metaRoute, orgSecrets } from "@/lib/compliance/webhooks";

// Threads delete callback (signed_request, verified with each organization's THREADS_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "threads", kind: "delete", secrets: orgSecrets(["THREADS_APP_SECRET"]) });
