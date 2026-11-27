import { metaRoute, orgSecrets } from "@/lib/compliance/webhooks";

// Threads uninstall callback (signed_request, verified with each organization's THREADS_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "threads", kind: "deauthorize", secrets: orgSecrets(["THREADS_APP_SECRET"]) });
