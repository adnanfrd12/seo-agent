import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigError, configForClient, type OrgConfig } from "@/lib/org/config";

export const AI_MODEL = "claude-opus-5-5";
// $ per million tokens for AI_MODEL (Anthropic first-party pricing)
const PRICE = { input: 4, output: 20, cacheRead: 0.2 };

/** The organization credential every Claude call uses (Settings → Integrations → Anthropic Claude). */
export const AI_KEY = "ANTHROPIC_API_KEY";

/** One client per API key (by hash), so organizations never share one and a changed key takes effect at once. */
const clients = new Map<string, Anthropic>();
const MAX_CLIENTS = 50;

/**
 * Claude on an organization's own Anthropic key. Throws a ConfigError (whose message says what to add where) when the
 * organization hasn't added one: there is no shared key and no fallback to another organization.
 */
export function anthropic(cfg: OrgConfig): Anthropic {
  const apiKey = cfg.require(AI_KEY);
  const id = createHash("sha256").update(apiKey).digest("base64url");
  let c = clients.get(id);
  if (!c) {
    if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value!);
    // authToken: null so a stray ANTHROPIC_AUTH_TOKEN in the server environment is never sent along
    c = new Anthropic({ apiKey, authToken: null });
    clients.set(id, c);
  }
  return c;
}

/** Claude for the organization a client belongs to (ConfigError when that organization has no Anthropic key). */
export async function anthropicFor(clientId: string): Promise<Anthropic> {
  return anthropic(await configForClient(clientId));
}

/**
 * Why Claude can't be used for this client right now (the setup instructions, or why the settings couldn't be read),
 * or null when it can. For pages that show or hide AI features and for checks before work starts.
 */
export async function aiUnavailable(clientId: string): Promise<string | null> {
  try {
    (await configForClient(clientId)).require(AI_KEY);
    return null;
  } catch (e) {
    return aiErrorMessage(e);
  }
}

export function costUsd(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) {
  const cached = usage.cache_read_input_tokens ?? 0;
  return (usage.input_tokens * PRICE.input + cached * PRICE.cacheRead + usage.output_tokens * PRICE.output) / 1_000_000;
}

/** Readable, non-leaky error text for the UI and run history. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof ConfigError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. An owner needs to check it in Settings → Integrations.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic rate limit reached. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError && /credit balance is too low/i.test(e.message)) return "The AI is paused: the organization's Anthropic account is out of credit. An owner needs to add credit at console.anthropic.com (Plans & Billing), then try again.";
  if (e instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? "network"}). Try again.`;
  const m = e instanceof Error ? e.message : "Unknown error";
  return m.startsWith("Missing or invalid environment variables") ? m : m.slice(0, 300);
}
