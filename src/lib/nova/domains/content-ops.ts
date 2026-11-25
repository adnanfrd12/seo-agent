import "server-only";
import type { NovaTool } from "../kit";
import { blogTools } from "./content-ops/blog";
import { reportTools } from "./content-ops/reports";
import { settingsTools } from "./content-ops/settings";
import { socialTools } from "./content-ops/social";
import { syncTools } from "./content-ops/syncs";

/**
 * Content, social and data operations: blog posts and blog updates, social media stats and profile links, data
 * source status, Sync now and what each source tracks, monthly reports and PDF imports, client settings and the
 * user's own name. Changes run the dashboard's own server actions after the user confirms in the chat.
 */
export const tools: NovaTool[] = [...blogTools, ...socialTools, ...syncTools, ...reportTools, ...settingsTools];
