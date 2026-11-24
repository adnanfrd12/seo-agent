import { metaRoute } from "@/lib/compliance/webhooks";

// Threads delete callback (signed_request, THREADS_APP_SECRET). See src/lib/compliance/webhooks.ts.
export const dynamic = "force-dynamic";
export const POST = metaRoute({ platform: "threads", kind: "delete", secret: () => process.env.THREADS_APP_SECRET?.trim() });
