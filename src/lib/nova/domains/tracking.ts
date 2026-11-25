import "server-only";
import type { NovaTool } from "../kit";
import { tools as ai } from "./tracking/ai";
import { tools as brand } from "./tracking/brand";
import { tools as competitors } from "./tracking/competitors";
import { tools as rank } from "./tracking/rank";

/** Tracked lists: rank-tracking keywords, AI visibility prompts and engines, competitors, brand terms and the research target. */
export const tools: NovaTool[] = [...rank, ...ai, ...competitors, ...brand];
