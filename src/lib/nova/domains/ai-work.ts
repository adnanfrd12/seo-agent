import "server-only";
import type { NovaTool } from "../kit";
import { tools as analysis } from "./ai-work/analysis";
import { tools as quickWins } from "./ai-work/quick-wins";
import { tools as settings } from "./ai-work/settings";

/** AI work lists: AI Quick Wins items and runs, AI insights and 30-day strategy (generation and statuses), SEO Coach, AI settings. */
export const tools: NovaTool[] = [...quickWins, ...analysis, ...settings];
