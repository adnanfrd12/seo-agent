import "server-only";
import type { NovaTool } from "../kit";
import { readTools } from "./seo-runs/reads";
import { writeTools } from "./seo-runs/writes";

/**
 * SEO research and audit runs (mostly paid DataForSEO): research refreshes and gaps, keyword research, site audit,
 * Lighthouse / Core Web Vitals / technical checks, SEOSignalX, local SEO and the SEO Toolkit, plus the spending limit.
 * Reads only read stored data (and collect finished background jobs for free, as the pages do). Writes call the
 * dashboard's own server actions after the user confirms, so their role, budget and freshness checks apply unchanged;
 * prepare states the cost (from the code's own estimates) and today's spend against the daily limit.
 */
export const tools: NovaTool[] = [...readTools, ...writeTools];
