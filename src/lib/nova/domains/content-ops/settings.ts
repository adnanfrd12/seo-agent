import "server-only";
import { z } from "zod";
import { updateClientSettings, updateProfile } from "@/app/(dashboard)/settings/actions";
import { bullets, fromAction, json, read, ToolError, write, type NovaTool } from "../../kit";
import { websiteOf } from "./shared";

/**
 * Settings page: the client's name, time zone and default date range, and the user's own display name.
 * Team members, roles, invitations and client access (Settings → Organization), passwords, the profile photo and
 * deleting the workspace stay in the dashboard.
 */

/** The IANA name Intl uses for a time zone, or null when it isn't one (the settings action checks the same way). */
function timeZone(tz: string): string | null {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).resolvedOptions().timeZone; } catch { return null; }
}

type ClientRow = { name: string; timezone: string; default_range_days: number };

export const settingsTools: NovaTool[] = [
  read({
    name: "get_client_settings",
    description: "The client's settings (name, website, time zone, default date range) and the user's own display name and role.",
    schema: z.object({}),
    async run(ctx) {
      const [{ data: c }, { data: me }, site] = await Promise.all([
        ctx.admin.from("clients").select("name, timezone, default_range_days").eq("id", ctx.client.id).maybeSingle(),
        ctx.admin.from("profiles").select("full_name").eq("user_id", ctx.userId).maybeSingle(),
        websiteOf(ctx.admin, ctx.client.id),
      ]);
      if (!c) throw new ToolError("Couldn't read the client's settings.");
      const row = c as ClientRow;
      return json({
        client: { name: row.name, time_zone: row.timezone, default_date_range_days: row.default_range_days, website: site ?? "not known yet", website_is: "the research target domain used for SEO research, blog and site checks" },
        you: { display_name: (me as { full_name: string | null } | null)?.full_name ?? null, role: ctx.client.role, can_change_client_settings: ctx.canEdit },
        settings_page: "/settings",
        only_on_the_settings_page: "password, profile photo and deleting the workspace (Settings → My account); team members, roles, invitations and client access (Settings → Organization → Team members)",
      });
    },
    summary: () => "Read client settings",
  }),

  write({
    name: "update_client_settings",
    description: "Change the client's name, time zone (IANA, e.g. America/Chicago) or default date range for dashboard pages (7, 30 or 90 days).",
    schema: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      timezone: z.string().trim().min(1).max(64).optional(),
      default_range_days: z.literal([7, 30, 90]).optional(),
    }),
    async prepare(ctx, i) {
      const { data } = await ctx.admin.from("clients").select("name, timezone, default_range_days").eq("id", ctx.client.id).maybeSingle();
      if (!data) throw new ToolError("Couldn't read the client's settings.");
      const c = data as ClientRow;
      const lines: string[] = [];
      const input: { name?: string; timezone?: string; default_range_days?: 7 | 30 | 90 } = {};
      if (i.name !== undefined && i.name !== c.name) { input.name = i.name; lines.push(`Client name: "${c.name}" → "${i.name}" (shown across the dashboard and in reports)`); }
      if (i.timezone !== undefined) {
        const tz = timeZone(i.timezone);
        if (!tz) return { error: `"${i.timezone}" isn't a time zone. Use an IANA name such as America/Chicago, Europe/London or UTC.` };
        if (tz !== c.timezone) { input.timezone = tz; lines.push(`Time zone: ${c.timezone} → ${tz} ("today", date ranges, months and the roadmap use it)`); }
      }
      if (i.default_range_days !== undefined && i.default_range_days !== c.default_range_days) {
        input.default_range_days = i.default_range_days;
        lines.push(`Default date range on dashboard pages: ${c.default_range_days} → ${i.default_range_days} days`);
      }
      if (!lines.length) return { error: "Nothing to change: the client already has those settings." };
      return { title: `Update the client settings of ${c.name}`, detail: bullets(lines), input };
    },
    async execute(x, i) {
      // the settings action saves all three fields: the ones not being changed are passed as they are now
      const { data } = await x.admin.from("clients").select("name, timezone, default_range_days").eq("id", x.client.id).maybeSingle();
      if (!data) return { ok: false, message: "Couldn't read the client's settings." };
      const c = data as ClientRow;
      const r = await updateClientSettings({ name: i.name ?? c.name, timezone: i.timezone ?? c.timezone, defaultRangeDays: i.default_range_days ?? c.default_range_days });
      return fromAction(r, "Client settings saved.", ["/settings"]);
    },
  }),

  write({
    name: "update_my_display_name",
    description: "Change the signed-in user's own display name (their profile only). Any role may do this.",
    roles: ["owner", "admin", "viewer"],
    schema: z.object({ full_name: z.string().trim().min(1).max(120) }),
    async prepare(ctx, i) {
      const { data } = await ctx.admin.from("profiles").select("full_name").eq("user_id", ctx.userId).maybeSingle();
      const old = (data as { full_name: string | null } | null)?.full_name ?? null;
      if (old === i.full_name) return { error: `Your display name is already "${i.full_name}".` };
      return { title: `Change your display name to "${i.full_name}"`, detail: `Your name: ${old ? `"${old}"` : "not set"} → "${i.full_name}". Only your own profile changes; your photo stays.` };
    },
    async execute(_x, i) {
      return fromAction(await updateProfile({ fullName: i.full_name }), "Profile saved.", ["/settings"]);
    },
  }),
];
