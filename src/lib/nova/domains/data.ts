import "server-only";
import { z } from "zod";
import { DATA_VIEWS, dataSources, detail, history, pageData } from "@/lib/ai/intelligence";
import { pageAllowed } from "@/lib/org/pages";
import { json, read, ToolError, type NovaTool } from "../kit";
import { NOT_IN_PLAN, viewAllowed } from "../pages";

/** Reading the client's data: the open page, connected sources, detailed views, competitors and monthly history. */
export const tools: NovaTool[] = [
  read({
    name: "get_page_data",
    description: "Read the data shown on the dashboard page the user has open. Use only when the question is about \"this page\", \"this screen\", \"here\" or what they see.",
    schema: z.object({}),
    async run(ctx) {
      if (!ctx.page) throw new ToolError("No page context: ask the user which data they mean.");
      if (!pageAllowed(ctx.enabledPages, ctx.page.path)) throw new ToolError(NOT_IN_PLAN);
      const data = await pageData(ctx.admin, ctx.client.id, await ctx.brief(), ctx.page.path);
      // what the user sees on screen (explanations, settings, tables) alongside the stored data behind it
      return ctx.page.text ? `${data}\n\nTEXT VISIBLE ON THE PAGE (as the user sees it):\n${ctx.page.text}` : data;
    },
    summary: () => "Read this page",
  }),
  read({
    name: "get_client_data_sources",
    description: "List the client's connected data sources, what is not available, and the data views get_client_analytics can return.",
    schema: z.object({}),
    async run(ctx) { return json(dataSources(await ctx.brief())); },
    summary: () => "Checked connected data sources",
  }),
  read({
    name: "get_client_analytics",
    description: `One detailed dataset as JSON (more than the brief). Views: ${DATA_VIEWS.map((v) => `${v.key} (${v.label})`).join("; ")}.`,
    schema: z.object({ view: z.enum(DATA_VIEWS.map((v) => v.key) as [string, ...string[]]) }),
    async run(ctx, a) {
      if (!viewAllowed(a.view, ctx.enabledPages)) throw new ToolError(NOT_IN_PLAN);
      return detail(ctx.admin, ctx.client.id, await ctx.brief(), a.view);
    },
    summary: (a) => `Read ${DATA_VIEWS.find((v) => v.key === a.view)?.label ?? a.view}`,
  }),
  read({
    name: "get_competitor_analysis",
    description: "Competitor sites with keyword counts and estimated traffic, keyword gaps, shared keywords where competitors outrank the client, and threats.",
    schema: z.object({}),
    async run(ctx) { return detail(ctx.admin, ctx.client.id, await ctx.brief(), "competitors"); },
    summary: () => "Read competitor analysis",
  }),
  read({
    name: "get_historical_performance",
    description: "Monthly totals for GA4, Search Console (web) and Business Profile over the last N complete months, for trends and year-over-year.",
    schema: z.object({ months: z.number().int().min(2).max(16).default(6) }),
    async run(ctx, a) { return history(ctx.db, ctx.client.id, ctx.client.timezone, a.months); },
    summary: (a) => `Read ${a.months} months of history`,
  }),
];
