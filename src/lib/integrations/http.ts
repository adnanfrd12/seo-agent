import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/analytics/client-context";
import { providerSchema, type ProviderId } from "./providers";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Reject cross-site form posts: if an Origin header is present it must match our host. */
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    throw new HttpError(403, "Cross-origin request rejected");
  }
}

export function parseProvider(raw: string): ProviderId {
  const p = providerSchema.safeParse(raw);
  if (!p.success) throw new HttpError(404, "Unknown provider");
  return p.data;
}

/** Signed-in owner/admin of the current client, or throws. */
export async function requireAdmin() {
  const { user, client } = await getSession();
  if (!client) throw new HttpError(400, "No client configured");
  if (!["owner", "admin"].includes(client.role)) throw new HttpError(403, "Admin role required");
  return { user, client };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  // serverEnv() throws a readable list of missing variable NAMES
  const msg = err instanceof Error ? err.message : "Unexpected error";
  if (msg.startsWith("Missing or invalid environment variables")) {
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  if (/Invalid API key|APIKey_InvalidAPIKey/i.test(msg)) {
    console.error("integration route error: Composio rejected COMPOSIO_API_KEY");
    return NextResponse.json(
      { error: "Composio rejected the API key. Check COMPOSIO_API_KEY in .env, then restart the server." },
      { status: 502 },
    );
  }
  if (/auth.?config|AuthConfig/i.test(msg) && /not.?found|404/i.test(msg)) {
    console.error("integration route error: Composio auth config not found");
    return NextResponse.json(
      { error: "Composio could not find that auth config. Check COMPOSIO_AUTH_CONFIG_* belongs to the same project as the API key." },
      { status: 502 },
    );
  }
  console.error("integration route error:", msg.slice(0, 500)); // message only; never request bodies or tokens
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
