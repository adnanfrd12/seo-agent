import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { requireOptional } from "@/lib/env";

export const AI_MODEL = "claude-opus-5-5";
// $ per million tokens for AI_MODEL (Anthropic first-party pricing)
const PRICE = { input: 4, output: 20, cacheRead: 0.2 };

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireOptional("ANTHROPIC_API_KEY") });
  return client;
}

export function costUsd(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) {
  const cached = usage.cache_read_input_tokens ?? 0;
  return (usage.input_tokens * PRICE.input + cached * PRICE.cacheRead + usage.output_tokens * PRICE.output) / 1_000_000;
}

/** Readable, non-leaky error text for the UI and run history. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic rate limit reached. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? "network"}). Try again.`;
  const m = e instanceof Error ? e.message : "Unknown error";
  return m.startsWith("Missing or invalid environment variables") ? m : m.slice(0, 300);
}
