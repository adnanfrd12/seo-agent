import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { setLeadType, setServiceArea } from "@/app/(dashboard)/analytics/ga4x-actions";
import { addRecordingReview } from "@/app/(dashboard)/clarity/actions";
import { checkPlatformReviews, findReviewListings, refreshPlatformReviews, saveReviewProfiles } from "@/app/(dashboard)/reviews/actions";
import { saveGscSettings } from "@/app/(dashboard)/search-console/gscx-actions";
import { DFS_NOT_CONFIGURED, dfsConfigured } from "@/lib/dataforseo/client";
import { LEAD_TYPES } from "@/lib/ga4x/model";
import { clientNap, CRAWLED } from "@/lib/reviews/listings";
import { defaultProfiles, getProfiles, loadPlatformReviews, PLATFORMS } from "@/lib/reviews/platforms";
import { bullets, fromAction, plural, read, ToolError, write, type ExecResult, type NovaTool } from "../kit";
import { checkReviewExtras, describeReview, FRICTION, REVIEW_COLS, reviewFields, SEVERITIES, type ReviewRow } from "./search-config/clarity";
import { autoType, EVENT_TYPES, leadSetup, typeLabel, type EventType } from "./search-config/ga4";
import { alerts, gscLists, kindOf, LIST_LABEL, LISTS, REPORTS, segments, storedGsc, watchlists, type ListKey } from "./search-config/gsc";
import { changeLine, clip, editList, fit, LIST_ACTIONS, quoteList, sameTerms, termNotes, termsArg, UUID } from "./search-config/lists";
import { checkLink, labelOf, linkSource, PLATFORM_KEYS, reviewCosts, reviewsView, usd } from "./search-config/reviews";

/**
 * Search and analytics setup, alerts and logs: the Search Console lists (brand, competitors, cities, services), its
 * watchlist / segment / alert reports, GA4 Lead setup (lead types, service area), the dashboard's alerts, Clarity
 * recording reviews, and reviews across platforms (listing links, refreshes).
 */
const GSC = ["/search-console"], ANALYTICS = ["/analytics"], CLARITY = ["/clarity", "/integrations"], REVIEWS = ["/reviews"], OVERVIEW = ["/overview"];
const SHORT: Record<ListKey, string> = { brand: "brand terms", competitors: "competitors", cities: "cities", services: "services" };
const listChange = z.object({ list: z.enum(LISTS), action: z.enum(LIST_ACTIONS), terms: termsArg(200) });
const areaChange = z.object({ action: z.enum(LIST_ACTIONS), cities: termsArg(300, 100) });

/** Names of the people who logged Clarity observations. */
async function reviewerNames(admin: SupabaseClient, rows: ReviewRow[]) {
  const ids = [...new Set(rows.map((r) => r.reviewer).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return new Map<string, string>();
  const { data } = await admin.from("profiles").select("user_id, full_name").in("user_id", ids);
  return new Map((data ?? []).filter((p) => p.full_name).map((p) => [String(p.user_id), String(p.full_name)]));
}

/** Several results of the dashboard's own actions as one ExecResult. */
function combine(done: string[], failed: string[], paths: string[]): ExecResult {
  if (!failed.length) return { ok: true, message: done.join(" "), paths };
  return { ok: false, message: [failed.join(" "), done.length ? `Done: ${done.join(" ")}` : ""].filter(Boolean).join(" "), paths: done.length ? paths : undefined };
}

export const tools: NovaTool[] = [
  /* ------------------------------------------------------------------ Search Console */
  read({
    name: "get_search_console_settings",
    description: "The brand, competitor, city and service lists of the Search Console screens (Brand, Local demand, segments, quick wins; separate from get_brand_terms): saved or automatic, with their terms.",
    schema: z.object({}),
    async run(ctx) {
      const L = await gscLists(ctx.admin, ctx.client.id);
      return fit({
        site: L.site ?? "Search Console isn't connected", connected: L.connected,
        lists: Object.fromEntries(LISTS.map((k) => [k, { label: LIST_LABEL[k], state: kindOf(k, L.now.src[k]), from: L.now.src[k], terms: L.now.s[k] }])),
        note: "Saved lists win; an empty list goes back to automatic (from the business name and domain, its city and service area, and phrases people search). Terms match whole words, case-insensitive.",
      });
    },
    summary: () => "Read the Search Console lists",
  }),
  read({
    name: "get_search_console_report",
    description: "A Search Console screen as data: watchlists (pages never clicked or never shown, click-rate changes), segments (devices, countries, search appearance, mobile vs desktop gaps) or alerts (insights, alerts fired in 90 days, rules).",
    schema: z.object({ report: z.enum(REPORTS), days: z.number().int().min(7).max(90).default(28) }),
    async run(ctx, a) {
      const v = await storedGsc(ctx.admin, ctx.client.id, a.report, a.days);
      if (!v) throw new ToolError("Search Console isn't connected for this client (Integrations page).");
      if (!v.g) throw new ToolError("Search Console hasn't synced yet: it syncs when a Search Console screen is first opened.");
      const g = v.g;
      const body = a.report === "watchlists" ? watchlists(g) : a.report === "segments" ? segments(g) : alerts(g);
      return fit({ site: v.site, period: `${g.p.start} to ${g.p.end}`, previous_period: `${g.p.pstart} to ${g.p.pend}`, synced_at: g.meta.fetchedAt.slice(0, 16), ...body });
    },
    summary: (a) => `Read Search Console ${a.report}`,
  }),
  write({
    name: "update_search_console_lists",
    description: "Change the brand, competitor, city or service list of the Search Console screens (separate from set_brand_terms): add or remove terms, replace a list, or set it back to automatic. Several lists in one call.",
    schema: z.object({ changes: z.array(listChange).min(1).max(12) }),
    async prepare(ctx, a) {
      const L = await gscLists(ctx.admin, ctx.client.id);
      const next = { ...L.saved };
      const touched = [...new Set(a.changes.map((c) => c.list))];
      const notes: string[] = [];
      for (const k of touched) {
        // edits start from the list as the screens use it now (saved, or the automatic one)
        const r = editList(L.now.s[k], a.changes.filter((c) => c.list === k), true);
        if ("error" in r) return { error: `${LIST_LABEL[k]}: ${r.error}` };
        if (r.list.length > 200) return { error: `${LIST_LABEL[k]} can hold at most 200 terms.` };
        notes.push(...termNotes(LIST_LABEL[k], r));
        next[k] = r.list;
      }
      const after = L.resolve(next);
      const lines = LISTS.flatMap((k) => changeLine(LIST_LABEL[k], { list: L.now.s[k], source: kindOf(k, L.now.src[k]) }, { list: after.s[k], source: kindOf(k, after.src[k]) }) ?? []);
      const changed = touched.filter((k) => !sameTerms(next[k], L.saved[k]));
      if (!lines.length || !changed.length) return { error: ["Nothing would change.", ...notes].join(" ") };
      const names = changed.map((k) => SHORT[k]);
      return {
        title: names.length === 1 ? `Update the Search Console ${names[0]} list` : `Update the Search Console lists: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`,
        detail: [bullets(lines), ...notes, "Every Search Console screen and its quick wins use these lists."].join("\n"),
        input: { changes: changed.map((k) => (next[k].length ? { list: k, action: "replace", terms: next[k] } : { list: k, action: "automatic", terms: [] })) },
      };
    },
    async execute(x, a) {
      // lists not in this change keep what is saved now (read again: the card may be hours old)
      const { data } = await x.admin.from("clients").select("settings").eq("id", x.client.id).maybeSingle();
      const raw = ((((data?.settings ?? {}) as Record<string, unknown>).gsc_settings ?? {}) as Partial<Record<ListKey, unknown>>);
      const input = {} as Record<ListKey, string>;
      for (const k of LISTS) {
        const saved = Array.isArray(raw[k]) ? (raw[k] as unknown[]).map(String) : [];
        const ch = a.changes.filter((c) => c.list === k);
        const r = ch.length ? editList(saved, ch, true) : { list: saved, missing: [] };
        if ("error" in r) return { ok: false, message: r.error };
        input[k] = r.list.join("\n");
      }
      return fromAction(await saveGscSettings(input), "Saved the Search Console lists.", GSC);
    },
  }),

  /* ------------------------------------------------------------------ GA4 Lead setup */
  read({
    name: "get_lead_setup",
    description: "GA4 Lead setup: every event with its lead type (automatic by name, or set by the user), whether it counts as a lead, key-event flag and count over the last 30 days, plus the service area cities.",
    schema: z.object({}),
    async run(ctx) {
      const s = await leadSetup(ctx.admin, ctx.client.id);
      return fit({
        ...(s.state === "ok" ? {} : { note: s.state === "no_ga4" ? "GA4 isn't connected for this client." : "GA4 hasn't synced yet: it syncs when a GA4 screen is first opened." }),
        property: s.property, period: s.end ? `last 30 days to ${s.end}` : null,
        lead_types: [...LEAD_TYPES, "Form start (counted for form abandonment, not as a lead)", "Not a lead"],
        events: s.events.map((e) => ({ event: e.event, type: e.type ?? "Not a lead", counts_as_lead: e.counts, set_by: e.override ? "user" : "automatic", rule: e.rule, key_event: e.key, count_30d: e.count })),
        service_area: { source: s.areaSource, saved: s.saved.length > 0, total: s.area.length, cities: s.area.slice(0, 80) },
      });
    },
    summary: () => "Read GA4 lead setup",
  }),
  write({
    name: "update_lead_setup",
    description: `Change GA4 Lead setup: set events' lead types (${LEAD_TYPES.join(", ")}, "Form start", "Not a lead", or "Automatic" for the rule by name) and edit the service area cities (add, remove, replace, or automatic).`,
    schema: z.object({
      event_types: z.array(z.object({ event: z.string().trim().min(1).max(200), type: z.enum(EVENT_TYPES) })).max(40).default([]),
      service_area: z.array(areaChange).max(6).default([]),
    }),
    async prepare(ctx, a) {
      if (!a.event_types.length && !a.service_area.length) return { error: "Nothing to change: give event_types or service_area." };
      const s = await leadSetup(ctx.admin, ctx.client.id);
      const lines: string[] = [], notes: string[] = [];
      const events: { event: string; type: EventType }[] = [];
      if (a.event_types.length) {
        if (s.state !== "ok") return { error: s.state === "no_ga4" ? "GA4 isn't connected for this client, so there are no events to set." : "GA4 hasn't synced yet: open the Lead setup screen once, then ask again." };
        const exact = new Map(s.events.map((e) => [e.event, e])), loose = new Map(s.events.map((e) => [e.event.toLowerCase(), e]));
        const want = new Map<string, EventType>();
        for (const c of a.event_types) {
          const e = exact.get(c.event) ?? loose.get(c.event.toLowerCase());
          if (!e) return { error: `"${c.event}" isn't an event in this GA4 property. Events: ${s.events.slice(0, 25).map((x) => x.event).join(", ")}.` };
          want.set(e.event, c.type);
        }
        for (const [event, type] of want) {
          const e = exact.get(event)!;
          if (type === "Automatic") {
            if (!e.override) { notes.push(`${event} already uses its automatic type: ${typeLabel(e).replace(/ \(automatic\)$/, "")}.`); continue; }
            lines.push(`${event}: ${typeLabel(e)} → ${autoType(event)} (automatic)`);
          } else {
            const same = (e.type ?? "Not a lead") === type;
            if (same && (e.override || e.counts || type === "Not a lead" || type === "Form start")) { notes.push(`${event} is already ${typeLabel(e)}.`); continue; }
            lines.push(`${event}: ${typeLabel(e)} → ${type} (set on Lead setup)`);
          }
          events.push({ event, type });
        }
      }
      let area: string[] | null = null;
      if (a.service_area.length) {
        // edits start from the area as the screens use it now (saved, or the automatic one)
        const ops = a.service_area.map((c) => ({ action: c.action, terms: c.cities }));
        const r = editList(s.area, ops, false);
        if ("error" in r) return { error: `Service area: ${r.error}` };
        if (r.list.length > 300) return { error: "The service area can hold at most 300 cities." };
        notes.push(...termNotes("Service area", r));
        const auto = !s.saved.length, toAuto = !r.list.length;
        const unchanged = toAuto ? auto : sameTerms(r.list, s.area) && (!auto || !ops.some((c) => c.action === "replace"));
        if (unchanged) notes.push(`The service area wouldn't change${auto ? " (it's automatic now)" : ""}.`);
        else {
          area = r.list;
          const whole = r.list.length <= 15 ? ` New list: ${quoteList(r.list, 15)}.` : "";
          if (toAuto) lines.push(`Service area: saved list of ${plural(s.saved.length, "city", "cities")} → automatic (${s.auto.areaSource.toLowerCase()}: ${plural(s.auto.area.length, "city", "cities")})`);
          else lines.push(`${changeLine("Service area", { list: s.area, source: auto ? "automatic" : "saved" }, { list: r.list, source: "saved" }) ?? "Service area: same cities in a new order"}.${whole}${auto ? " A saved list stops updating by itself." : ""}`);
        }
      }
      if (!lines.length) return { error: ["Nothing would change.", ...notes].join(" ") };
      const what = [events.length ? plural(events.length, "event type") : "", area ? "the service area" : ""].filter(Boolean).join(" and ");
      return {
        title: events.length === 1 && !area ? `Set ${events[0].event} to ${events[0].type} in GA4 Lead setup` : `Update GA4 Lead setup: ${what}`,
        detail: [bullets(lines, 20), ...notes, "Every GA4 screen and its quick wins count leads with these settings."].join("\n"),
        input: { event_types: events, service_area: area ? [area.length ? { action: "replace", cities: area } : { action: "automatic", cities: [] }] : [] },
      };
    },
    async execute(x, a) {
      const done: string[] = [], failed: string[] = [];
      for (const e of a.event_types) {
        const r = await setLeadType(e.event, e.type === "Automatic" ? null : e.type === "Not a lead" ? "" : e.type);
        if (r.ok) done.push(r.message); else failed.push(`${e.event}: ${r.message}`);
      }
      if (a.service_area.length) {
        // the stored change is the whole list (or automatic); applied to what is saved now
        const { data } = await x.admin.from("clients").select("settings").eq("id", x.client.id).maybeSingle();
        const st = (data?.settings ?? {}) as Record<string, unknown>;
        const saved = Array.isArray(st.ga4_service_area) ? (st.ga4_service_area as unknown[]).map(String) : [];
        const r = editList(saved, a.service_area.map((c) => ({ action: c.action, terms: c.cities })), false);
        if ("error" in r) failed.push(`Service area: ${r.error}`);
        else {
          const res = await setServiceArea(r.list.join("\n"));
          if (res.ok) done.push(res.message); else failed.push(`Service area: ${res.message}`);
        }
      }
      return combine(done, failed, ANALYTICS);
    },
  }),

  /* ------------------------------------------------------------------ dashboard alerts */
  read({
    name: "get_dashboard_alerts",
    description: "The dashboard's alerts from the daily check (traffic drops and gains, integrations needing attention, backlink changes, audit errors, rank and AI visibility drops, competitors, unhappy reviews), newest first, with ids and read state.",
    schema: z.object({ show: z.enum(["all", "unread", "read"]).default("all"), limit: z.number().int().min(1).max(50).default(20) }),
    async run(ctx, a) {
      const base = ctx.admin.from("client_alerts").select("id, kind, severity, title, body, created_at, seen_at").eq("client_id", ctx.client.id);
      const q = a.show === "unread" ? base.is("seen_at", null) : a.show === "read" ? base.not("seen_at", "is", null) : base;
      const [{ data, error }, { count }] = await Promise.all([
        q.order("created_at", { ascending: false }).limit(a.limit),
        ctx.admin.from("client_alerts").select("id", { count: "exact", head: true }).eq("client_id", ctx.client.id).is("seen_at", null),
      ]);
      if (error) throw new ToolError("The alerts couldn't be read.");
      return fit({
        unread: count ?? 0,
        alerts: (data ?? []).map((r) => ({ id: r.id, severity: r.severity, kind: r.kind, title: r.title, detail: clip(r.body, 400), date: String(r.created_at).slice(0, 10), read: Boolean(r.seen_at) })),
        note: "Each situation is reported once. They show on the Overview page.",
      });
    },
    summary: () => "Read the dashboard alerts",
  }),
  write({
    name: "mark_dashboard_alerts_read",
    description: "Mark dashboard alerts as read: the given alert ids, or every unread alert when none are given. Any team member may do this.",
    roles: ["owner", "admin", "viewer"],
    schema: z.object({ alert_ids: z.array(z.string().trim()).max(100).default([]) }),
    async prepare(ctx, a) {
      const bad = a.alert_ids.filter((id) => !UUID.test(id));
      if (bad.length) return { error: `Not alert ids: ${bad.slice(0, 5).join(", ")}. Read the alerts first to get their ids.` };
      const base = ctx.admin.from("client_alerts").select("id, severity, title, seen_at").eq("client_id", ctx.client.id);
      const { data, error } = await (a.alert_ids.length ? base.in("id", a.alert_ids) : base.is("seen_at", null)).order("created_at", { ascending: false }).limit(200);
      if (error) throw new ToolError("The alerts couldn't be read.");
      const rows = data ?? [];
      const missing = a.alert_ids.filter((id) => !rows.some((r) => r.id === id));
      if (missing.length) return { error: `No alert ${missing.slice(0, 3).join(", ")} for this client. Read the alerts first to get their ids.` };
      const unread = rows.filter((r) => !r.seen_at);
      if (!unread.length) return { error: a.alert_ids.length ? "Those alerts are already read." : "There are no unread alerts." };
      return {
        title: `Mark ${plural(unread.length, "alert")} as read`,
        detail: [bullets(unread.map((r) => `${r.severity}: ${r.title}`)), a.alert_ids.length > unread.length ? `${plural(a.alert_ids.length - unread.length, "alert")} already read.` : "", "The dashboard has no way to mark them unread again."].filter(Boolean).join("\n"),
        input: { alert_ids: unread.map((r) => r.id) },
      };
    },
    async execute(x, a) {
      if (!a.alert_ids.length) return { ok: false, message: "No alerts were given." };
      const { data, error } = await x.admin.from("client_alerts").update({ seen_at: new Date().toISOString() })
        .eq("client_id", x.client.id).in("id", a.alert_ids).is("seen_at", null).select("id");
      if (error) return { ok: false, message: "Could not update the alerts." };
      const n = data?.length ?? 0;
      return { ok: true, message: n ? `Marked ${plural(n, "alert")} as read.` : "Those alerts were already read.", paths: OVERVIEW };
    },
  }),

  /* ------------------------------------------------------------------ Clarity recording reviews */
  read({
    name: "get_clarity_recording_reviews",
    description: "Observations logged from Clarity session recordings (page, issue type, severity, device, what happened, who logged it), newest first, with ids.",
    schema: z.object({ severity: z.enum(SEVERITIES).optional(), friction_type: z.enum(FRICTION).optional(), limit: z.number().int().min(1).max(50).default(25) }),
    async run(ctx, a) {
      let q = ctx.admin.from("clarity_recording_reviews").select(REVIEW_COLS, { count: "exact" }).eq("client_id", ctx.client.id);
      if (a.severity) q = q.eq("severity", a.severity);
      if (a.friction_type) q = q.eq("friction_type", a.friction_type);
      const { data, count, error } = await q.order("created_at", { ascending: false }).limit(a.limit);
      if (error) throw new ToolError("Clarity recording reviews couldn't be read.");
      const rows = (data ?? []) as ReviewRow[];
      const names = await reviewerNames(ctx.admin, rows);
      return fit({
        total: count ?? rows.length,
        reviews: rows.map((r) => ({ id: r.id, page_url: r.page_url, issue: r.friction_type, severity: r.severity, device: r.device, observed_on: r.observed_on, observation: clip(r.observation, 600), recording_url: r.recording_url, logged_on: r.created_at.slice(0, 10), by: (r.reviewer && names.get(r.reviewer)) || null })),
        note: rows.length ? "The AI analysis uses these as evidence." : "None logged yet. They're added on the Integrations page (Clarity recording reviews) or through Nova.",
      });
    },
    summary: () => "Read Clarity recording observations",
  }),
  write({
    name: "add_clarity_recording_reviews",
    description: "Log observations from watching Clarity session recordings (page, issue type, severity, device, what happened); the AI analysis uses them as evidence. Any team member may do this.",
    roles: ["owner", "admin", "viewer"],
    schema: z.object({
      reviews: z.array(z.object({
        page_url: reviewFields.page_url, recording_url: reviewFields.recording_url.optional(), device: reviewFields.device.default("unknown"),
        observed_on: reviewFields.observed_on.optional(), friction_type: reviewFields.friction_type, severity: reviewFields.severity.default("medium"), observation: reviewFields.observation,
      })).min(1).max(10),
    }),
    async prepare(ctx, a) {
      for (const [i, r] of a.reviews.entries()) {
        const bad = checkReviewExtras(r.recording_url || undefined, r.observed_on || undefined);
        if (bad) return { error: a.reviews.length > 1 ? `Observation ${i + 1}: ${bad}` : bad };
      }
      // skip exact repeats of what is already logged
      const { data } = await ctx.admin.from("clarity_recording_reviews").select("page_url, friction_type, observation").eq("client_id", ctx.client.id).order("created_at", { ascending: false }).limit(300);
      const key = (r: { page_url: string; friction_type: string; observation: string }) => `${r.page_url.trim().toLowerCase()}|${r.friction_type}|${r.observation.trim().toLowerCase()}`;
      const have = new Set((data ?? []).map(key));
      const fresh = a.reviews.filter((r, i) => !have.has(key(r)) && a.reviews.findIndex((o) => key(o) === key(r)) === i);
      if (!fresh.length) return { error: "These observations are already logged." };
      const skipped = a.reviews.length - fresh.length;
      return {
        title: fresh.length === 1 ? `Log a Clarity observation for ${clip(fresh[0].page_url, 70)}` : `Log ${fresh.length} Clarity recording observations`,
        detail: [bullets(fresh.map((r) => describeReview({ ...r, observed_on: r.observed_on || null }))), skipped ? `${plural(skipped, "duplicate")} skipped (already logged or repeated).` : "", "The next AI analysis uses them as evidence."].filter(Boolean).join("\n"),
        input: { reviews: fresh },
      };
    },
    async execute(_x, a) {
      let saved = 0;
      const errors: string[] = [];
      for (const r of a.reviews) {
        const res = await addRecordingReview({ ...r, recording_url: r.recording_url || undefined, observed_on: r.observed_on || undefined });
        if (res.ok) saved++; else errors.push(res.error);
      }
      if (!errors.length) return { ok: true, message: saved === 1 ? "Observation saved. The next AI analysis uses it as evidence." : `${saved} observations saved. The next AI analysis uses them as evidence.`, paths: CLARITY };
      return { ok: false, message: `${saved ? `${plural(saved, "observation")} saved; ` : ""}${errors.length} not saved: ${[...new Set(errors)].join(" ")}`, paths: saved ? CLARITY : undefined };
    },
  }),
  write({
    name: "edit_clarity_recording_reviews",
    description: 'Edit fields of logged Clarity recording observations, or delete them (ids from get_clarity_recording_reviews). recording_url or observed_on "" clears it.',
    schema: z.object({
      update: z.array(z.object({
        id: z.string().trim(), page_url: reviewFields.page_url.optional(), recording_url: reviewFields.recording_url.optional(), device: reviewFields.device.optional(),
        observed_on: reviewFields.observed_on.optional(), friction_type: reviewFields.friction_type.optional(), severity: reviewFields.severity.optional(), observation: reviewFields.observation.optional(),
      })).max(20).default([]),
      delete_ids: z.array(z.string().trim()).max(50).default([]),
    }),
    async prepare(ctx, a) {
      if (!a.update.length && !a.delete_ids.length) return { error: "Nothing to change: give update or delete_ids." };
      const ids = [...a.update.map((u) => u.id), ...a.delete_ids];
      const bad = ids.filter((id) => !UUID.test(id));
      if (bad.length) return { error: `Not observation ids: ${bad.slice(0, 5).join(", ")}. Read the observations first to get their ids.` };
      if (new Set(ids).size !== ids.length) return { error: "Each observation can appear only once (edited or deleted, not both)." };
      const { data, error } = await ctx.admin.from("clarity_recording_reviews").select(REVIEW_COLS).eq("client_id", ctx.client.id).in("id", ids);
      if (error) throw new ToolError("Clarity recording reviews couldn't be read.");
      const byId = new Map(((data ?? []) as ReviewRow[]).map((r) => [r.id, r]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) return { error: `No observation ${missing.slice(0, 3).join(", ")} for this client. Read the observations first to get their ids.` };
      const lines: string[] = [], notes: string[] = [];
      const update: Record<string, string>[] = [];
      for (const u of a.update) {
        const bad2 = checkReviewExtras(u.recording_url || undefined, u.observed_on || undefined);
        if (bad2) return { error: bad2 };
        const r = byId.get(u.id)!;
        const { id, ...fields } = u;
        const diffs = Object.entries(fields).filter(([k, v]) => v !== undefined && (v || null) !== (r[k as keyof ReviewRow] ?? null)) as [string, string][];
        if (!diffs.length) { notes.push(`This observation already has those values: ${describeReview(r)}`); continue; }
        lines.push(`Edit ${describeReview(r)} → ${diffs.map(([k, v]) => `${k.replace(/_/g, " ")}: ${clip(String(r[k as keyof ReviewRow] ?? "(none)"), 60)} → ${v ? clip(v, 60) : "(none)"}`).join("; ")}`);
        update.push({ id, ...Object.fromEntries(diffs) });
      }
      for (const id of a.delete_ids) lines.push(`Delete ${describeReview(byId.get(id)!)}`);
      if (!lines.length) return { error: ["Nothing would change.", ...notes].join(" ") };
      const parts = [update.length ? `edit ${update.length}` : "", a.delete_ids.length ? `delete ${a.delete_ids.length}` : ""].filter(Boolean).join(" and ");
      return {
        title: `${parts[0].toUpperCase()}${parts.slice(1)} Clarity observation${update.length + a.delete_ids.length > 1 ? "s" : ""}`,
        detail: [bullets(lines), ...notes, a.delete_ids.length ? "Deleted observations can't be restored." : ""].filter(Boolean).join("\n"),
        input: { update, delete_ids: a.delete_ids },
      };
    },
    async execute(x, a) {
      let edited = 0, deleted = 0;
      for (const { id, ...fields } of a.update) {
        if (checkReviewExtras(fields.recording_url || undefined, fields.observed_on || undefined)) return { ok: false, message: "The stored change is no longer valid. Ask Nova again." };
        const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v || null]));
        const { data, error } = await x.admin.from("clarity_recording_reviews").update(patch).eq("client_id", x.client.id).eq("id", id).select("id");
        if (error) return { ok: false, message: `Could not save the changes${edited ? ` (${edited} saved before the error)` : ""}.` };
        edited += data?.length ?? 0;
      }
      if (a.delete_ids.length) {
        const { data, error } = await x.admin.from("clarity_recording_reviews").delete().eq("client_id", x.client.id).in("id", a.delete_ids).select("id");
        if (error) return { ok: false, message: `Could not delete the observations${edited ? ` (${plural(edited, "edit")} saved)` : ""}.` };
        deleted = data?.length ?? 0;
      }
      const said = [edited ? `updated ${plural(edited, "observation")}` : "", deleted ? `deleted ${plural(deleted, "observation")}` : ""].filter(Boolean).join(" and ");
      return said ? { ok: true, message: `${said[0].toUpperCase()}${said.slice(1)}.`, paths: CLARITY } : { ok: false, message: "Those observations no longer exist." };
    },
  }),

  /* ------------------------------------------------------------------ reviews across platforms */
  read({
    name: "get_review_platforms",
    description: "Reviews across platforms (Google, Trustpilot, Yelp, YellowPages, Nextdoor, Angi and more): each platform's listing link and its source, rating, review count and status, combined numbers, the latest reviews and refresh costs.",
    schema: z.object({
      platform: z.enum(PLATFORM_KEYS).optional().describe("only this platform's reviews"),
      reviews: z.number().int().min(0).max(40).default(12),
      unanswered_only: z.boolean().default(false),
    }),
    async run(ctx, a) {
      const v = await reviewsView(ctx.admin, ctx.client.id);
      const list = v.all.filter((r) => (!a.platform || r.platform === a.platform) && (!a.unanswered_only || !r.reply))
        .sort((x, y) => (y.date ?? "").localeCompare(x.date ?? "")).slice(0, a.reviews)
        .map((r) => ({ platform: labelOf(r.platform), rating: r.rating, date: r.date, author: r.author, text: clip(r.text, 280), reply: clip(r.reply, 160) }));
      const configured = await dfsConfigured(ctx.client.id);
      const c = configured ? await reviewCosts(ctx.admin, ctx.client.id, v.views, v.discovery?.at ?? null) : null;
      const content = fit({
        summary: v.summary, platforms: v.platforms, latest_reviews: list, listing_search: v.listingSearch,
        ...(v.pending ? { collecting: "Some reviews are still being collected; they appear within a few minutes." } : {}),
        ...(v.collected ? { just_collected: `${plural(v.collected, "finished collection")} saved now.` } : {}),
        // the spend line is for owners and admins, as on the Reviews page
        costs: c ? { refresh_all: usd(c.refresh), find_listings_again: usd(c.find), ...(ctx.canEdit ? { spent_today: usd(c.spentAll), daily_budget: usd(c.cap) } : {}) } : "DataForSEO isn't set up for this organization: reviews can't be refreshed.",
        note: "Refreshes run weekly on their own. Saved links win over found ones and the defaults.",
      });
      if (!v.collected) return content;
      return { content, changed: true, action: { tool: "get_review_platforms", ok: true, summary: `Read reviews (saved ${plural(v.collected, "finished collection")})` } };
    },
    summary: () => "Read reviews across platforms",
  }),
  write({
    name: "update_review_listing_links",
    description: 'Save or remove review listing links per platform (saved links win over the ones found automatically and the defaults). url "" removes the saved link.',
    schema: z.object({ links: z.array(z.object({ platform: z.enum(PLATFORM_KEYS), url: z.string().trim().max(500) })).min(1).max(13) }),
    async prepare(ctx, a) {
      const [{ saved, views, discovery }, defaults] = await Promise.all([loadPlatformReviews(ctx.admin, ctx.admin, ctx.client.id), defaultProfiles(ctx.admin, ctx.client.id)]);
      const lines: string[] = [], notes: string[] = [];
      const links: { platform: string; url: string }[] = [];
      const last = new Map(a.links.map((l) => [l.platform, l.url]));
      for (const [platform, raw] of last) {
        const p = PLATFORMS.find((x) => x.key === platform)!, v = views.find((x) => x.platform === platform)!;
        const now = v.url ? `${v.url} (${linkSource(v, saved)})` : "(none)";
        if (!raw) {
          if (!saved[platform]) { notes.push(`${p.label} has no saved link to remove${v.url ? `; it uses the ${linkSource(v, saved)} link ${v.url}` : ""}.`); continue; }
          const fallback = discovery?.links[platform]?.url ?? defaults[platform];
          const kind = discovery?.links[platform]?.url ? "found" : "default";
          lines.push(`${p.label}: remove the saved link ${saved[platform]}${!fallback ? "" : fallback === saved[platform] ? ` (the ${kind} link is the same address, so ${p.label} is still read)` : ` (it goes back to the ${kind} link ${fallback})`}`);
          links.push({ platform, url: "" });
          continue;
        }
        const check = checkLink(platform, raw);
        if ("error" in check) return { error: check.error };
        if (saved[platform] === check.url) { notes.push(`${p.label} already has this link saved.`); continue; }
        lines.push(`${p.label}: ${now} → ${check.url}${p.access === "credentials" ? " (link only: reading its reviews needs the client's credentials)" : p.access === "none" ? " (link only: no public reviews)" : ""}`);
        links.push({ platform, url: check.url });
      }
      if (!links.length) return { error: ["Nothing would change.", ...notes].join(" ") };
      return {
        title: links.length === 1 ? `${links[0].url ? "Save" : "Remove"} the ${labelOf(links[0].platform)} listing link` : `Update ${links.length} review listing links`,
        detail: [bullets(lines), ...notes, "New links are read on the next review refresh (weekly, or ask me to refresh now)."].join("\n"),
        input: { links },
      };
    },
    async execute(x, a) {
      // merged into what is saved now; the Reviews page's save replaces the whole set
      const next: Record<string, string> = { ...(await getProfiles(x.admin, x.client.id)) };
      for (const l of a.links) { if (l.url) next[l.platform] = l.url; else delete next[l.platform]; }
      return fromAction(await saveReviewProfiles(next), "Saved the listing links.", REVIEWS);
    },
  }),
  write({
    name: "refresh_platform_reviews",
    description: "Paid (DataForSEO): refresh reviews on every readable platform now (mode refresh), or search again for the business's listings on YellowPages, Nextdoor, Yelp, BBB, Angi, Houzz and Thumbtack and read them (mode find_listings). The prepared change states the cost.",
    schema: z.object({ mode: z.enum(["refresh", "find_listings"]).default("refresh") }),
    async prepare(ctx, a) {
      if (!(await dfsConfigured(ctx.client.id))) return { error: `${DFS_NOT_CONFIGURED} Until then reviews can't be refreshed.` };
      const { views, discovery } = await loadPlatformReviews(ctx.admin, ctx.admin, ctx.client.id);
      const c = await reviewCosts(ctx.admin, ctx.client.id, views, discovery?.at ?? null);
      const est = a.mode === "find_listings" ? c.find : c.refresh;
      const spend = `DataForSEO spend today: ${usd(c.spentAll)} of the ${usd(c.cap)} daily budget (this client ${usd(c.spentClient)} of its ${usd(c.clientCap)} share).`;
      const tight = c.spentAll + est > c.cap || c.spentClient + est > c.clientCap ? "Today's budget may run out partway; whatever is read before that is saved." : "";
      const nap = await clientNap(ctx.admin, ctx.client.id).catch(() => null);
      if (a.mode === "find_listings") {
        if (!nap) return { error: "The business's name, address and phone aren't known: connect its Google Business Profile first." };
        return {
          title: `Search for the business's review listings again (≈${usd(est)})`,
          detail: bullets([
            `Looks up ${nap.name}${nap.phone ? ` (${nap.phone})` : ""}: YellowPages by phone, Nextdoor by name, city and phone, and Google for Yelp, BBB, Angi, Houzz and Thumbtack.`,
            `Then reads the listing pages it finds. Saved links keep priority.${discovery ? ` Last search: ${discovery.at.slice(0, 10)}.` : ""}`,
            `Cost ≈${usd(est)} (DataForSEO). ${spend}`, tight,
          ].filter(Boolean)),
          expectSeconds: 120,
        };
      }
      if (!c.google && !c.apis.length && !c.pages.length && !(c.searchDue && nap)) return { error: "There's nothing to refresh: no listing links are known. Save listing links or connect the Google Business Profile first." };
      return {
        title: `Refresh reviews on every platform (≈${usd(est)})`,
        detail: bullets([
          c.google ? "Google: the newest 100 reviews, through DataForSEO" : "",
          c.apis.length ? `${c.apis.map(labelOf).join(", ")}: reviews through DataForSEO` : "",
          c.searchDue && nap ? `The monthly listing search is due, so it runs first (${CRAWLED.map(labelOf).join(", ")}, Yelp)` : "",
          c.pages.length ? `Listing pages read now: ${c.pages.map(labelOf).join(", ")}` : "",
          c.running.length ? `Still collecting from the last refresh: ${c.running.join(", ")}. Finished collections are saved first (free); one still running is left to finish and not started again.` : "",
          `Cost at most ≈${usd(est)} (DataForSEO). ${spend}`, tight,
          "DataForSEO reviews arrive within a few minutes; ask me afterwards to see them.",
        ].filter(Boolean)),
        expectSeconds: c.pages.length || (c.searchDue && nap) ? 90 : 20,
      };
    },
    async execute(_x, a) {
      if (a.mode === "find_listings") return fromAction(await findReviewListings(), "Listing search finished.", REVIEWS);
      // like the weekly run: save collections that finished (free) first, so a stale "collecting" doesn't block the refresh
      await checkPlatformReviews();
      return fromAction(await refreshPlatformReviews(), "Review refresh started.", REVIEWS);
    },
  }),
];
