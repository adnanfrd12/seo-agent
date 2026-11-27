// Multi-tenant isolation check, end to end, against the real database with real signed-in sessions.
//
//   npx tsx --tsconfig tests/tsconfig.test.json --env-file=.env scripts/qa-orgs.mts
//
//   --allow-pending   a migration after 036 (037-039) isn't applied yet: warn and carry on instead of stopping
//   --cleanup         only remove what an interrupted run left behind (QA users, organizations, clients, files)
//
// Organization A is the first, real organization (Waheed Zen LLC): it is only ever read. Everything else is created
// here with unique, labelled names and removed again in a finally block (also on Ctrl+C):
//   - organization "QA Org B <time>" with one client ("QA Client B <run>"), an invitation and an audit entry
//   - users with random @example.test addresses and random passwords (generated here, never printed): ownerB,
//     adminB, memberB (team member, viewer of client B only), inviteeB (accepts an invitation) and outsider (no
//     membership anywhere)
// Every user signs in with the publishable key and every row-level-security check runs as that user. The server
// helpers (configuration, credentials, permission guards, and members, invitations, clients, branding, spend and
// connection tests when those files exist) are called for organization B and must never return or use organization
// A's data or credentials. No paid API call is made and no email is sent.
// Prints PASS / FAIL / WARN / SKIP per check, then what was removed.
// Exit code: 0 = no FAIL, 1 = at least one FAIL, 2 = can't run (migration missing, environment incomplete).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/org/permissions";

// The app's modules are loaded with require(), as they load each other: one instance of each (one configuration
// cache, one ConfigError class), like in the bundled app. An ESM import here would be a second copy under tsx.
const load = createRequire(import.meta.url);
const { decryptSecret } = load("@/lib/crypto") as typeof import("@/lib/crypto");
const { ConfigError, configForClient, orgConfig } = load("@/lib/org/config") as typeof import("@/lib/org/config");
const { audit, deleteCredential, importFromEnv, listCredentials, setCredential } = load("@/lib/org/credentials") as typeof import("@/lib/org/credentials");
const { guardMemberChange } = load("@/lib/org/permissions") as typeof import("@/lib/org/permissions");
const { INTEGRATIONS } = load("@/lib/org/registry") as typeof import("@/lib/org/registry");

type Sb = SupabaseClient;
type Row = Record<string, unknown>;
type PgError = { code?: string; message?: string } | null;

/* ================================================================================================== setup */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SERVICE_KEY || !process.env.TOKEN_ENCRYPTION_KEY) {
  console.error("Run it with --env-file=.env (needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY).");
  process.exit(2);
}
const ARGS = new Set(process.argv.slice(2));
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin: Sb = createClient(SUPABASE_URL, SERVICE_KEY, NO_SESSION);
const anon: Sb = createClient(SUPABASE_URL, PUBLISHABLE_KEY, NO_SESSION);
const started = Date.now();

const STAMP = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const RUN = `${STAMP}-${randomBytes(3).toString("hex")}`;
const MARKER = "Temporary organization created by scripts/qa-orgs.mts; deleted at the end of the run.";
const QA_EMAIL = /^qa-orgs-(\d{14})-[0-9a-f]{6}-[a-z]+@example\.test$/;
const QA_ORG = /^QA Org B (\d{14})$/;
const QA_CLIENT = /^QA Client \S+ (\d{14})-[0-9a-f]{6}$/;
const STRAY_ORG = `QA should-not-exist ${RUN}`;
const BUCKET = "org-assets";
const QA_KEY = "QA_TEST_KEY";

// values that must never be printed: every key, secret, token and password of the environment, plus the ones made here
const SECRETS = new Set(Object.entries(process.env).filter(([k, v]) => v && v.length >= 8 && /KEY|SECRET|TOKEN|PASSWORD/i.test(k)).map(([, v]) => v as string));
const scrub = (s: string) => [...SECRETS].reduce((t, v) => t.split(v).join("••••"), s);

/* ================================================================================================== output */
type Status = "PASS" | "FAIL" | "WARN" | "SKIP";
const counts: Record<Status, number> = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
const failures: string[] = [];
function report(status: Status, what: string, detail?: string) {
  counts[status]++;
  const line = scrub(`${status.padEnd(4)}  ${what}${detail ? `  (${detail})` : ""}`);
  if (status === "FAIL") failures.push(line);
  console.log(line);
}
const check = (ok: boolean, what: string, detail?: string) => report(ok ? "PASS" : "FAIL", what, detail);
const section = (title: string) => console.log(`\n== ${title}`);
const errText = (e: unknown) => scrub(e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 200);
const pgErr = (e: PgError) => (e ? `${e.code ?? "error"} ${(e.message ?? "").slice(0, 80)}` : "no error");
const isDenied = (e: PgError) => Boolean(e && (e.code === "42501" || /permission denied|row-level security|forbidden/i.test(e.message ?? "")));
let interrupted = false;
async function step(what: string, fn: () => Promise<void>) {
  if (interrupted) return;
  try { await fn(); } catch (e) { report("FAIL", what, `stopped: ${errText(e)}`); }
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** readable names for ids in the output (the real organization's rows are only ever counted) */
const labels = new Map<string, string>();
function describe(keys: string[]): string {
  const named: string[] = [];
  let other = 0;
  for (const k of keys) {
    const parts = k.split(":");
    if (parts.every((p) => labels.has(p))) named.push(parts.map((p) => labels.get(p)).join("/"));
    else other++;
  }
  const out = named.slice(0, 5);
  if (named.length > 5) out.push(`${named.length - 5} more`);
  if (other) out.push(`${other} row${other === 1 ? "" : "s"} of other organizations`);
  return out.join(", ") || "nothing";
}
function sameSet(actual: string[], expected: string[]) {
  const a = new Set(actual), e = new Set(expected);
  const extra = [...a].filter((x) => !e.has(x)), missing = [...e].filter((x) => !a.has(x));
  const ok = !extra.length && !missing.length;
  return { ok, detail: ok ? (a.size ? describe([...a]) : "nothing") : [extra.length ? `also sees ${describe(extra)}` : "", missing.length ? `doesn't see ${describe(missing)}` : ""].filter(Boolean).join("; ") };
}
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x); }));
}
/** A module written by another part of the project: null (with the reason) while it doesn't exist or doesn't load. */
async function optional<T>(spec: string): Promise<{ mod: T | null; why: string }> {
  const file = `${spec.replace(/^@\//, "src/")}.ts`;
  if (!existsSync(file)) return { mod: null, why: `${file} doesn't exist yet` };
  try { return { mod: load(spec) as T, why: "" }; } catch (e) { return { mod: null, why: `${file} doesn't load: ${errText(e)}` }; }
}
const isConfigError = (e: unknown): e is Error => e instanceof ConfigError || (e instanceof Error && e.name === "ConfigError");

/* ================================================================================================== migrations */
interface SchemaProp { description?: string; format?: string; type?: string }
interface RestSchema {
  paths: Record<string, { post?: { parameters?: { in?: string; schema?: { properties?: Record<string, SchemaProp>; required?: string[] } }[] } }>;
  definitions: Record<string, { properties?: Record<string, SchemaProp> }>;
}
let schemaCache: RestSchema | null = null;
async function restSchema(): Promise<RestSchema> {
  if (schemaCache) return schemaCache;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`the API schema answered ${r.status}`);
  return (schemaCache = (await r.json()) as RestSchema);
}
const rpcSchema = (s: RestSchema, fn: string) => s.paths[`/rpc/${fn}`]?.post?.parameters?.find((p) => p.in === "body")?.schema;

const MIGRATIONS = "supabase/migrations";
const FIRST_ORG_MIGRATION = 36, LAST_ORG_MIGRATION = 39;
const publicName = (raw: string) => { const p = raw.replace(/"/g, "").toLowerCase().split("."); return p.length === 1 ? p[0] : p[0] === "public" ? p[1] : null; };
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (const c of s) {
    if (c === "'") quoted = !quoted;
    if (!quoted && c === "(") depth++;
    if (!quoted && c === ")") depth--;
    if (!quoted && depth === 0 && c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function closingParen(s: string, from: number): number {
  let depth = 1, quoted = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")" && --depth === 0) return i;
  }
  return s.length;
}
/** What a migration creates that the API can see: tables and views, added columns, functions (with parameter names), buckets. */
function expectedObjects(sql: string) {
  const s = sql.replace(/--[^\n]*/g, " ");
  const e = { tables: new Set<string>(), columns: new Map<string, Set<string>>(), functions: new Map<string, string[]>(), buckets: new Set<string>() };
  const re = /\bcreate\s+(?:or\s+replace\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?([\w."]+)|\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)([^;]*);|\bcreate\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(|\bdrop\s+(?:table|view)\s+(?:if\s+exists\s+)?([\w."]+)|\bdrop\s+function\s+(?:if\s+exists\s+)?([\w."]+)\s*\(([^)]*)\)|\binsert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*\(\s*'([^']+)'/gi;
  for (const m of s.matchAll(re)) {
    if (m[1]) { const t = publicName(m[1]); if (t) e.tables.add(t); }
    else if (m[2]) {
      const t = publicName(m[2]);
      if (!t) continue;
      const cols = e.columns.get(t) ?? new Set<string>();
      for (const c of m[3].matchAll(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?([\w"]+)/gi)) cols.add(c[1].replace(/"/g, "").toLowerCase());
      for (const c of m[3].matchAll(/\bdrop\s+column\s+(?:if\s+exists\s+)?([\w"]+)/gi)) cols.delete(c[1].replace(/"/g, "").toLowerCase());
      if (cols.size) e.columns.set(t, cols); else e.columns.delete(t);
    } else if (m[4]) {
      const f = publicName(m[4]);
      if (!f) continue;
      const open = (m.index ?? 0) + m[0].length, close = closingParen(s, open);
      if (/^\s*returns\s+(?:setof\s+)?(?:event_)?trigger\b/i.test(s.slice(close + 1, close + 80))) continue;
      e.functions.set(f, splitTopLevel(s.slice(open, close)).map((p) => p.trim().split(/\s+/)).map((w) => (/^(in|out|inout|variadic)$/i.test(w[0]) ? w.slice(1) : w))
        .filter((w) => w.length >= 2).map((w) => w[0].replace(/"/g, "").toLowerCase()));
    } else if (m[5]) { const t = publicName(m[5]); if (t) e.tables.delete(t); }
    else if (m[6]) { const f = publicName(m[6]); const n = m[7].trim() ? splitTopLevel(m[7]).length : 0; if (f && e.functions.get(f)?.length === n) e.functions.delete(f); }
    else if (m[8]) e.buckets.add(m[8]);
  }
  return e;
}
async function missingObjects(file: string, schema: RestSchema): Promise<{ missing: string[]; total: number }> {
  const e = expectedObjects(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));
  const missing: string[] = [];
  let total = 0;
  for (const t of e.tables) { total++; if (!schema.definitions[t]) missing.push(`table ${t}`); }
  for (const [t, cols] of e.columns) for (const c of cols) { total++; if (!schema.definitions[t]?.properties?.[c]) missing.push(`column ${t}.${c}`); }
  for (const [f, params] of e.functions) {
    total++;
    if (!schema.paths[`/rpc/${f}`]) { missing.push(`function ${f}()`); continue; }
    const have = new Set(Object.keys(rpcSchema(schema, f)?.properties ?? {}));
    const lacking = params.filter((p) => !have.has(p));
    if (lacking.length) missing.push(`function ${f}(${lacking.join(", ")})`);
  }
  for (const b of e.buckets) { total++; const { error } = await admin.storage.getBucket(b); if (error) missing.push(`storage bucket ${b}`); }
  return { missing, total };
}
/** Stops the run (exit 2) unless the organization migrations are applied; returns the later ones still pending (--allow-pending). */
async function checkMigrations(): Promise<Set<string>> {
  section("Migrations");
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_[\w-]+\.sql$/.test(f))
    .filter((f) => { const n = Number(f.slice(8, 14)); return n >= FIRST_ORG_MIGRATION && n <= LAST_ORG_MIGRATION; }).sort();
  if (!files.some((f) => Number(f.slice(8, 14)) === FIRST_ORG_MIGRATION)) {
    console.error(`No …0000${FIRST_ORG_MIGRATION}_organizations.sql in ${MIGRATIONS}: run this from the repository root.`);
    process.exit(2);
  }
  const schema = await restSchema();
  const pending = new Set<string>();
  for (const f of files) {
    const { missing, total } = await missingObjects(f, schema);
    const first = Number(f.slice(8, 14)) === FIRST_ORG_MIGRATION;
    if (!total) report("WARN", `${f}: nothing the API can see to verify (policies or grants only); assumed applied`);
    else if (!missing.length) report("PASS", `${f} is applied`, `${total} tables, columns, functions and buckets found`);
    else {
      pending.add(f);
      report(!first && ARGS.has("--allow-pending") ? "WARN" : "FAIL", `${f} is not applied`, `missing ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`);
    }
  }
  if ([...pending].some((f) => Number(f.slice(8, 14)) === FIRST_ORG_MIGRATION)) {
    console.log(`\nApply ${MIGRATIONS}/${files[0]} first (Supabase SQL editor or supabase db push), then run this again. Nothing was created.`);
    process.exit(2);
  }
  if (pending.size && !ARGS.has("--allow-pending")) {
    console.log(`\nApply ${[...pending].join(", ")} first, or run again with --allow-pending to check everything else now. Nothing was created.`);
    process.exit(2);
  }
  return pending;
}

/* ================================================================================================== fixtures */
const ROLES = ["ownerB", "adminB", "memberB", "inviteeB", "outsider"] as const;
type Role = (typeof ROLES)[number];
/** the users whose view of the database is compared (inviteeB only joins late, through an invitation) */
const VIEWERS = ["ownerB", "adminB", "memberB", "outsider"] as const;
interface QaUser { role: Role; id: string; email: string; sb: Sb }
const U = {} as Record<Role, QaUser>;

/** everything this run created, for the cleanup */
const created = { users: [] as string[], orgs: [] as string[], clients: [] as string[], files: [] as string[] };
let orgA = { id: "", name: "", usesEnvFallback: false, clients: [] as string[] };
let clientA = "";
let orgB = "", clientB = "", inviteB = "", inviteToken = "";
let qaKeyInAEarlier = false;
let pending = new Set<string>();
const pendingMigration = (n: number) => [...pending].some((f) => Number(f.slice(8, 14)) === n);

async function loadOrgA() {
  const { data: orgs, error } = await admin.from("organizations").select("id, name, uses_env_fallback, description, created_at").order("created_at");
  if (error) throw new Error(`couldn't read organizations: ${error.message}`);
  const real = (orgs ?? []).filter((o) => o.description !== MARKER && !QA_ORG.test(o.name as string));
  const a = real.find((o) => o.name === "Waheed Zen LLC") ?? real[0];
  if (!a) { console.error("No organization to compare with: is the 036 backfill applied?"); process.exit(2); }
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("clients").select("id").eq("organization_id", a.id).order("id").range(from, from + 999);
    ids.push(...(data ?? []).map((c) => c.id as string));
    if (!data || data.length < 1000) break;
  }
  orgA = { id: a.id as string, name: a.name as string, usesEnvFallback: Boolean(a.uses_env_fallback), clients: ids };
  // the test client named in the project brief, else the first client of organization A
  clientA = ids.includes("8fff48ac-a073-45b4-b17e-0e02c6309700") ? "8fff48ac-a073-45b4-b17e-0e02c6309700" : ids[0] ?? "";
  if (!clientA) { console.error(`${orgA.name} has no clients to compare with.`); process.exit(2); }
  labels.set(orgA.id, `organization A (${orgA.name})`);
  labels.set(clientA, "client A");
}

async function createFixtures() {
  section("Fixtures");
  const { data: org, error: oErr } = await admin.from("organizations")
    .insert({ name: `QA Org B ${STAMP}`, description: MARKER, website: "https://example.test", uses_env_fallback: false }).select("id").single();
  if (oErr || !org) throw new Error(`couldn't create organization B: ${oErr?.message}`);
  orgB = org.id as string;
  created.orgs.push(orgB);
  labels.set(orgB, "organization B");

  const { data: cl, error: cErr } = await admin.from("clients").insert({ name: `QA Client B ${RUN}`, timezone: "UTC", organization_id: orgB }).select("id").single();
  if (cErr || !cl) throw new Error(`couldn't create client B: ${cErr?.message}`);
  clientB = cl.id as string;
  created.clients.push(clientB);
  labels.set(clientB, "client B");

  for (const role of ROLES) {
    if (interrupted) throw new Error("interrupted");
    const email = `qa-orgs-${RUN}-${role.toLowerCase()}@example.test`;
    const password = `${randomBytes(24).toString("base64url")}aA1!`;
    SECRETS.add(password);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `QA ${role}` } });
    if (error || !data.user) throw new Error(`couldn't create the test user ${role}: ${error?.message}`);
    created.users.push(data.user.id);
    labels.set(data.user.id, role);
    const sb = createClient(SUPABASE_URL, PUBLISHABLE_KEY, NO_SESSION);
    const { error: sErr } = await sb.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(`the test user ${role} couldn't sign in: ${sErr.message}`);
    U[role] = { role, id: data.user.id, email, sb };
  }

  const { error: mErr } = await admin.from("organization_members").insert([
    { organization_id: orgB, user_id: U.ownerB.id, role: "owner" },
    { organization_id: orgB, user_id: U.adminB.id, role: "admin" },
    { organization_id: orgB, user_id: U.memberB.id, role: "member" },
  ]);
  if (mErr) throw new Error(`couldn't add the members of organization B: ${mErr.message}`);
  const { error: aErr } = await admin.from("client_members").insert({ client_id: clientB, user_id: U.memberB.id, role: "viewer" });
  if (aErr) throw new Error(`couldn't give memberB access to client B: ${aErr.message}`);

  // an open invitation for inviteeB whose client access was tampered with: it also names a client of organization A
  inviteToken = randomBytes(32).toString("base64url");
  SECRETS.add(inviteToken);
  const { data: inv, error: iErr } = await admin.from("organization_invitations").insert({
    organization_id: orgB, email: U.inviteeB.email, role: "viewer", token_hash: sha256(inviteToken), invited_by: U.ownerB.id,
    client_access: [{ client_id: clientA, role: "owner" }, { client_id: clientB, role: "viewer" }],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  }).select("id").single();
  if (iErr || !inv) throw new Error(`couldn't create the invitation: ${iErr?.message}`);
  inviteB = inv.id as string;
  labels.set(inviteB, "invitation B");
  await audit(admin, orgB, U.ownerB.id, "qa.fixture", null, { run: RUN });

  const { data: qa } = await admin.from("organization_credentials").select("key").eq("organization_id", orgA.id).eq("key", QA_KEY).maybeSingle();
  qaKeyInAEarlier = Boolean(qa);
  report("PASS", `created organization B "QA Org B ${STAMP}" with client B, 5 signed-in test users, an invitation and an audit entry`,
    `compared with ${orgA.name}: ${orgA.clients.length} clients`);
}

/* ================================================================================================== truth (service role) */
async function svc(table: string, cols: string, filter: (q: ReturnType<ReturnType<Sb["from"]>["select"]>) => typeof q): Promise<Row[]> {
  const { data, error } = await filter(admin.from(table).select(cols)).limit(10000);
  if (error) throw new Error(`reading ${table}: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}
const bClients = async () => (await svc("clients", "id", (q) => q.eq("organization_id", orgB))).map((r) => r.id as string);

/** keys of what a user can read in a table */
async function seen(u: QaUser, table: string, cols: string, key: (r: Row) => string): Promise<{ keys: string[]; error: PgError }> {
  const { data, error } = await u.sb.from(table).select(cols).limit(5000);
  return { keys: ((data ?? []) as unknown as Row[]).map(key), error };
}

/* ================================================================================================== checks */
async function createClientChecks() {
  section("create_client (as each user)");
  const make = async (u: QaUser, label: string, org?: string) => {
    const name = `QA Client ${label} ${RUN}`;
    const { data, error } = await u.sb.rpc("create_client", { p_name: name, p_timezone: "UTC", ...(org ? { p_organization: org } : {}) });
    const id = typeof data === "string" ? data : null;
    if (id) { created.clients.push(id); labels.set(id, `client ${label}`); }
    const { data: row } = id ? await admin.from("clients").select("organization_id").eq("id", id).maybeSingle() : { data: null };
    const { data: cm } = id ? await admin.from("client_members").select("role").eq("client_id", id).eq("user_id", u.id).maybeSingle() : { data: null };
    return { id, error: error as PgError, org: (row?.organization_id as string | undefined) ?? null, clientRole: (cm?.role as string | undefined) ?? null };
  };
  let r = await make(U.ownerB, "B2", orgB);
  check(Boolean(r.id) && r.org === orgB && r.clientRole === "owner", "ownerB creates a client in organization B (p_organization = B)", r.id ? `lands in ${labels.get(r.org ?? "") ?? "another organization"}, client role ${r.clientRole}` : pgErr(r.error));
  r = await make(U.ownerB, "B3");
  check(Boolean(r.id) && r.org === orgB, "ownerB creates a client without naming an organization: it lands in organization B", r.id ? `lands in ${labels.get(r.org ?? "") ?? "another organization"}` : pgErr(r.error));
  r = await make(U.adminB, "B4", orgB);
  check(Boolean(r.id) && r.org === orgB && r.clientRole === "admin", "adminB creates a client in organization B", r.id ? `client role ${r.clientRole}` : pgErr(r.error));
  r = await make(U.ownerB, "Aattempt", orgA.id);
  check(!r.id && isDenied(r.error), `ownerB can't create a client in ${orgA.name}`, r.id ? `created one in ${labels.get(r.org ?? "") ?? "another organization"}` : pgErr(r.error));
  r = await make(U.memberB, "Mattempt", orgB);
  check(!r.id && isDenied(r.error), "memberB (team member) can't create clients", r.id ? "created one" : pgErr(r.error));
  r = await make(U.outsider, "Oattempt");
  check(!r.id && isDenied(r.error), "outsider can't create clients", r.id ? "created one" : pgErr(r.error));
}

async function visibilityChecks() {
  section("What each user can read (row-level security)");
  const allB = await bClients();
  const members = (await svc("organization_members", "organization_id, user_id", (q) => q.eq("organization_id", orgB))).map((r) => `${r.organization_id}:${r.user_id}`);
  const invites = (await svc("organization_invitations", "id", (q) => q.eq("organization_id", orgB))).map((r) => r.id as string);
  const auditRows = await svc("organization_audit_log", "id", (q) => q.eq("organization_id", orgB));
  for (const r of auditRows) labels.set(String(r.id), "an audit entry of B");
  const auditB = auditRows.map((r) => String(r.id));
  const access = (await svc("client_members", "client_id, user_id", (q) => q.in("client_id", allB))).map((r) => `${r.client_id}:${r.user_id}`);
  const [aMembers, aInvites, aAudit] = await Promise.all(["organization_members", "organization_invitations", "organization_audit_log"].map(async (t) =>
    (await admin.from(t).select("organization_id", { count: "exact", head: true }).eq("organization_id", orgA.id)).count ?? 0));

  const expect: Record<(typeof VIEWERS)[number], Record<string, string[]>> = {
    ownerB: { organizations: [orgB], clients: allB, organization_members: members, organization_invitations: invites, organization_audit_log: auditB, client_members: access },
    adminB: { organizations: [orgB], clients: allB, organization_members: members, organization_invitations: invites, organization_audit_log: auditB, client_members: access },
    memberB: { organizations: [orgB], clients: [clientB], organization_members: [`${orgB}:${U.memberB.id}`], organization_invitations: [], organization_audit_log: [], client_members: access.filter((k) => k.startsWith(`${clientB}:`)) },
    outsider: { organizations: [], clients: [], organization_members: [], organization_invitations: [], organization_audit_log: [], client_members: [] },
  };
  const tables: [string, string, (r: Row) => string, string][] = [
    ["organizations", "id", (r) => String(r.id), ""],
    ["clients", "id", (r) => String(r.id), `${orgA.name} has ${orgA.clients.length}`],
    ["organization_members", "organization_id, user_id", (r) => `${r.organization_id}:${r.user_id}`, `organization A has ${aMembers}`],
    ["organization_invitations", "id", (r) => String(r.id), `organization A has ${aInvites}`],
    ["organization_audit_log", "id", (r) => String(r.id), `organization A has ${aAudit}`],
    ["client_members", "client_id, user_id", (r) => `${r.client_id}:${r.user_id}`, ""],
  ];
  for (const role of VIEWERS) {
    for (const [table, cols, key, aNote] of tables) {
      const { keys, error } = await seen(U[role], table, cols, key);
      const r = sameSet(keys, expect[role][table]);
      const leakedA = table === "clients" ? keys.filter((k) => orgA.clients.includes(k)).length : 0;
      check(!error && r.ok, `${role} reads ${table}: exactly what it should`, `${error ? pgErr(error) : r.detail}${table === "clients" ? `; ${leakedA} of ${orgA.name}'s ${orgA.clients.length} clients` : aNote ? `; ${aNote}` : ""}`);
    }
    const creds = await U[role].sb.from("organization_credentials").select("key").limit(5);
    check(Boolean(creds.error) || !(creds.data ?? []).length, `${role} can't read organization_credentials`, creds.error ? pgErr(creds.error) : `${creds.data?.length} rows`);
    const admins = await U[role].sb.from("platform_admins").select("user_id").limit(5);
    check(!admins.error && !(admins.data ?? []).length, `${role} sees no platform admins`, admins.error ? pgErr(admins.error) : `${admins.data?.length} rows`);
  }

  section("Access functions (as each user)");
  const orgRole: Record<(typeof VIEWERS)[number], string | null> = { ownerB: "owner", adminB: "admin", memberB: "member", outsider: null };
  const inB: Record<(typeof VIEWERS)[number], boolean> = { ownerB: true, adminB: true, memberB: true, outsider: false };
  const manages: Record<(typeof VIEWERS)[number], boolean> = { ownerB: true, adminB: true, memberB: false, outsider: false };
  for (const role of VIEWERS) {
    const sb = U[role].sb;
    const [mA, mB, mBadmin, rA, rB, gA, gB] = await Promise.all([
      sb.rpc("is_client_member", { p_client_id: clientA }), sb.rpc("is_client_member", { p_client_id: clientB }),
      sb.rpc("is_client_member", { p_client_id: clientB, p_roles: ["owner", "admin"] }),
      sb.rpc("org_role", { p_org: orgA.id }), sb.rpc("org_role", { p_org: orgB }),
      sb.rpc("get_client_members", { p_client_id: clientA }), sb.rpc("get_client_members", { p_client_id: clientB }),
    ]);
    const ok = mA.data === false && mB.data === inB[role] && mBadmin.data === manages[role] && rA.data === null && rB.data === orgRole[role]
      && isDenied(gA.error as PgError) && (inB[role] ? !gB.error : isDenied(gB.error as PgError));
    check(ok, `${role}: is_client_member, org_role and get_client_members answer for organization B only`,
      `client A member ${mA.data}, client B member ${mB.data}, client B manager ${mBadmin.data}, role in A ${rA.data}, role in B ${rB.data}, client A members ${gA.error ? "refused" : "ANSWERED"}, client B members ${gB.error ? "refused" : "answered"}`);
  }
}

async function writeChecks() {
  section("Writes signed-in users can't make directly");
  const attempt = async (what: string, run: () => PromiseLike<{ data: unknown; error: PgError }>, unchanged: () => Promise<boolean> = async () => true) => {
    const { data, error } = await run();
    const rows = Array.isArray(data) ? data.length : data ? 1 : 0;
    const same = await unchanged();
    check((Boolean(error) || rows === 0) && same, what, error ? pgErr(error) : `${plural(rows, "row")} written${same ? "" : ", data changed"}`);
  };
  const orgRow = async () => (await admin.from("organizations").select("name, uses_env_fallback").eq("id", orgB).single()).data as Row;
  const roleOf = async (u: QaUser) => ((await admin.from("organization_members").select("role").eq("organization_id", orgB).eq("user_id", u.id).maybeSingle()).data?.role ?? null) as string | null;
  const clientBRow = async () => (await admin.from("clients").select("name, organization_id").eq("id", clientB).single()).data as Row;
  const before = await clientBRow();

  await attempt("ownerB can't create an organization", async () => {
    const r = await U.ownerB.sb.from("organizations").insert({ name: STRAY_ORG }).select("id");
    for (const o of (r.data ?? []) as Row[]) created.orgs.push(o.id as string);
    return r;
  });
  await attempt("ownerB can't turn on the environment fallback (organization A's credentials) for organization B",
    () => U.ownerB.sb.from("organizations").update({ uses_env_fallback: true }).eq("id", orgB).select("id"),
    async () => (await orgRow()).uses_env_fallback === false);
  await attempt("adminB can't make itself owner", () => U.adminB.sb.from("organization_members").update({ role: "owner" }).eq("organization_id", orgB).eq("user_id", U.adminB.id).select("role"),
    async () => (await roleOf(U.adminB)) === "admin");
  await attempt("memberB can't raise its own role", () => U.memberB.sb.from("organization_members").update({ role: "admin" }).eq("organization_id", orgB).eq("user_id", U.memberB.id).select("role"),
    async () => (await roleOf(U.memberB)) === "member");
  await attempt("outsider can't add itself to organization B", () => U.outsider.sb.from("organization_members").insert({ organization_id: orgB, user_id: U.outsider.id, role: "owner" }).select("role"),
    async () => (await roleOf(U.outsider)) === null);
  await attempt("outsider can't make itself a platform admin", () => U.outsider.sb.from("platform_admins").insert({ user_id: U.outsider.id }).select("user_id"),
    async () => !(await admin.from("platform_admins").select("user_id").eq("user_id", U.outsider.id).maybeSingle()).data);
  await attempt("ownerB can't write organization_credentials directly", () => U.ownerB.sb.from("organization_credentials").insert({ organization_id: orgB, key: "QA_DIRECT_WRITE", integration: "custom", value_encrypted: "x" }).select("key"));
  await attempt("ownerB can't write or erase audit entries", async () => {
    const w = await U.ownerB.sb.from("organization_audit_log").insert({ organization_id: orgB, action: "qa.forged" }).select("id");
    const d = await U.ownerB.sb.from("organization_audit_log").delete().eq("organization_id", orgB).select("id");
    return { data: [...((w.data ?? []) as unknown[]), ...((d.data ?? []) as unknown[])], error: w.error && d.error ? w.error : null };
  }, async () => ((await admin.from("organization_audit_log").select("id", { count: "exact", head: true }).eq("organization_id", orgB).eq("action", "qa.fixture")).count ?? 0) === 1);
  await attempt("ownerB can't create invitations directly", () => U.ownerB.sb.from("organization_invitations").insert({ organization_id: orgB, email: `qa-orgs-${RUN}-direct@example.test`, role: "owner", token_hash: sha256(randomUUID()), expires_at: new Date(Date.now() + 3_600_000).toISOString() }).select("id"));
  await attempt("ownerB can't move client B to organization A", () => U.ownerB.sb.from("clients").update({ organization_id: orgA.id }).eq("id", clientB).select("id"),
    async () => (await clientBRow()).organization_id === orgB);
  await attempt("memberB (client viewer) can't rename client B", () => U.memberB.sb.from("clients").update({ name: `QA renamed ${RUN}` }).eq("id", clientB).select("id"),
    async () => (await clientBRow()).name === before.name);
  await attempt("outsider can't rename client B", () => U.outsider.sb.from("clients").update({ name: `QA renamed ${RUN}` }).eq("id", clientB).select("id"),
    async () => (await clientBRow()).name === before.name);
  await attempt("outsider can't give itself access to client B", () => U.outsider.sb.from("client_members").insert({ client_id: clientB, user_id: U.outsider.id, role: "owner" }).select("client_id"));
  await attempt("memberB can't give itself more access", () => U.memberB.sb.from("client_members").update({ role: "owner" }).eq("client_id", clientB).eq("user_id", U.memberB.id).select("role"),
    async () => ((await admin.from("client_members").select("role").eq("client_id", clientB).eq("user_id", U.memberB.id).single()).data?.role) === "viewer");
  await attempt("adminB can't delete organization B", () => U.adminB.sb.from("organizations").delete().eq("id", orgB).select("id"),
    async () => Boolean((await admin.from("organizations").select("id").eq("id", orgB).maybeSingle()).data));
  // the organization role reaches the client without a client_members row: an owner may rename it (then it's put back)
  const { data: renamed, error: rErr } = await U.ownerB.sb.from("clients").update({ name: `${before.name} (renamed)` }).eq("id", clientB).select("id");
  check(!rErr && (renamed ?? []).length === 1, "ownerB (organization owner, no client role) can rename client B", rErr ? pgErr(rErr) : `${renamed?.length} row`);
  await admin.from("clients").update({ name: before.name }).eq("id", clientB);
}

async function deactivationChecks() {
  section("Deactivated members lose access");
  const setStatus = (u: QaUser, status: "active" | "deactivated") => admin.from("organization_members").update({ status }).eq("organization_id", orgB).eq("user_id", u.id);
  const view = async (u: QaUser) => {
    const [c, m, o, r] = await Promise.all([
      seen(u, "clients", "id", (x) => String(x.id)), u.sb.rpc("is_client_member", { p_client_id: clientB }),
      seen(u, "organizations", "id", (x) => String(x.id)), u.sb.rpc("org_role", { p_org: orgB }),
    ]);
    return { clients: c.keys, member: m.data, orgs: o.keys, role: r.data };
  };
  try {
    await setStatus(U.memberB, "deactivated");
    let v = await view(U.memberB);
    check(!v.clients.length && v.member === false && !v.orgs.length && v.role === null, "memberB deactivated: no client, no organization, is_client_member(client B) = false",
      `${v.clients.length} clients, member ${v.member}, ${v.orgs.length} organizations`);
    await setStatus(U.memberB, "active");
    v = await view(U.memberB);
    check(sameSet(v.clients, [clientB]).ok && v.member === true, "memberB reactivated: client B again", `${describe(v.clients)}, member ${v.member}`);

    await setStatus(U.adminB, "deactivated");
    v = await view(U.adminB);
    const make = await U.adminB.sb.rpc("create_client", { p_name: `QA Client Dattempt ${RUN}`, p_organization: orgB });
    if (typeof make.data === "string") created.clients.push(make.data);
    check(!v.clients.length && v.member === false && v.role === null && Boolean(make.error), "adminB deactivated: no clients, no role, can't create clients",
      `${v.clients.length} clients, role ${v.role}, create_client ${make.error ? "refused" : "ALLOWED"}`);
    await setStatus(U.adminB, "active");
    v = await view(U.adminB);
    check(sameSet(v.clients, await bClients()).ok && v.role === "admin", "adminB reactivated: every client of organization B again", `${v.clients.length} clients, role ${v.role}`);
  } finally {
    await setStatus(U.memberB, "active");
    await setStatus(U.adminB, "active");
  }
}

async function credentialChecks() {
  section("Credentials and configuration (config.ts, credentials.ts)");
  const dummyB = `qa-${randomBytes(20).toString("hex")}`;
  SECRETS.add(dummyB);
  const registryKeys = INTEGRATIONS.flatMap((i) => i.fields.map((f) => f.key));
  const envKeys = registryKeys.filter((k) => process.env[k]?.trim());

  const saved = await setCredential(admin, orgB, U.ownerB.id, QA_KEY, dummyB);
  check(saved.ok, `setCredential stores ${QA_KEY} for organization B`, saved.ok ? undefined : saved.error);
  const { data: row } = await admin.from("organization_credentials").select("value_encrypted, hint, is_secret, integration").eq("organization_id", orgB).eq("key", QA_KEY).maybeSingle();
  const enc = String(row?.value_encrypted ?? ""), hint = String(row?.hint ?? "");
  let decrypted = "";
  try { decrypted = decryptSecret(enc); } catch { /* reported below */ }
  check(Boolean(row) && !enc.includes(dummyB) && enc.startsWith("v1.") && decrypted === dummyB && !hint.includes(dummyB.slice(0, -4)) && row?.is_secret === true,
    "it is stored encrypted (AES-GCM) with only a masked hint", row ? `hint ${hint.length} characters, integration ${row.integration}` : "no row");

  const cfgB = await configForClient(clientB), cfgA = await configForClient(clientA);
  check(cfgB.orgId === orgB && cfgA.orgId === orgA.id, "configForClient resolves each client's own organization", `client B → ${labels.get(cfgB.orgId) ?? "other"}, client A → ${labels.get(cfgA.orgId) ?? "other"}`);
  check(cfgB.get(QA_KEY) === dummyB, `configForClient(client B) returns organization B's ${QA_KEY}`);
  check(qaKeyInAEarlier ? cfgA.get(QA_KEY) !== dummyB : cfgA.get(QA_KEY) === undefined, `configForClient(client A) doesn't see organization B's ${QA_KEY}`, qaKeyInAEarlier ? "organization A has a QA_TEST_KEY of its own (left alone)" : undefined);
  const leaked = registryKeys.filter((k) => cfgB.get(k) !== undefined);
  check(!leaked.length, "configForClient(client B) returns none of organization A's credentials (no fallback)", leaked.length ? `returns ${leaked.join(", ")}` : `${registryKeys.length} keys checked`);
  const aStored = new Set((await svc("organization_credentials", "key", (q) => q.eq("organization_id", orgA.id))).map((r) => r.key as string));
  const aMissing = envKeys.filter((k) => !cfgA.get(k));
  check(!aMissing.length, `organization A still resolves its credentials`, aMissing.length ? `missing ${aMissing.join(", ")}` : `${envKeys.length} keys: ${envKeys.filter((k) => aStored.has(k)).length} stored, ${envKeys.filter((k) => !aStored.has(k)).length} from the server environment (fallback ${orgA.usesEnvFallback ? "on" : "off"})`);
  const unknown = await orgConfig(randomUUID());
  check(!registryKeys.some((k) => unknown.get(k)), "an unknown organization id resolves nothing (no environment fallback)");
  let configErr: unknown = null;
  try { cfgB.require("DATAFORSEO_PASSWORD"); } catch (e) { configErr = e; }
  check(isConfigError(configErr) && /Settings → Integrations/.test(configErr.message) && scrub(configErr.message) === configErr.message,
    "a missing credential is a ConfigError with instructions and no secret in it", configErr instanceof Error ? configErr.message.slice(0, 110) : "no error");
  let noClient: unknown = null;
  try { await configForClient(randomUUID()); } catch (e) { noClient = e; }
  check(noClient instanceof Error, "configForClient(unknown client) throws instead of guessing an organization");

  const listB = await listCredentials(admin, orgB), listA = await listCredentials(admin, orgA.id);
  const envShown = listB.filter((c) => c.source === "env").map((c) => c.key);
  const mine = listB.find((c) => c.key === QA_KEY);
  check(!envShown.length && mine?.source === "org" && !(mine.display ?? "").includes(dummyB.slice(0, -4)), "listCredentials(B): only B's own values, masked; none from the server environment",
    envShown.length ? `shows ${envShown.join(", ")} from the environment` : `${listB.filter((c) => c.source).length} set`);
  check(qaKeyInAEarlier || !listA.some((c) => c.key === QA_KEY), `listCredentials(A) doesn't list organization B's ${QA_KEY}`);
  const reserved = await setCredential(admin, orgB, U.ownerB.id, "SUPABASE_SERVICE_ROLE_KEY", "qa-should-be-refused");
  check(!reserved.ok, "setCredential refuses platform keys (SUPABASE_SERVICE_ROLE_KEY)", reserved.ok ? "stored" : reserved.error);
  const imported = await importFromEnv(admin, orgB, U.ownerB.id);
  const keysB = (await svc("organization_credentials", "key", (q) => q.eq("organization_id", orgB))).map((r) => r.key as string);
  check(!imported.ok && sameSet(keysB, [QA_KEY]).ok, "organization B can't import the server environment (organization A's credentials)", imported.ok ? `imported ${imported.imported.length}` : imported.error);

  const auditB = await svc("organization_audit_log", "id, action, target, detail", (q) => q.eq("organization_id", orgB));
  const credAudit = auditB.find((r) => r.action === "credential.create" && r.target === QA_KEY);
  check(Boolean(credAudit) && !JSON.stringify(auditB).includes(dummyB), "the change is in organization B's audit log, without the value", credAudit ? `${auditB.length} entries` : "no credential.create entry");
  const [oSees, mSees] = await Promise.all([U.ownerB, U.memberB].map((u) => seen(u, "organization_audit_log", "id", (r) => String(r.id))));
  check(oSees.keys.includes(String(credAudit?.id)) && !mSees.keys.length, "ownerB reads that audit entry; memberB reads no audit entries", `ownerB ${oSees.keys.length}, memberB ${mSees.keys.length}`);
  const qaIds = Object.values(U).map((u) => u.id);
  const { count: strayA } = await admin.from("organization_audit_log").select("id", { count: "exact", head: true }).eq("organization_id", orgA.id).in("actor_user_id", qaIds);
  check(!strayA, "nothing this run did was written to organization A's audit log", `${strayA ?? 0} entries`);

  const del = await deleteCredential(admin, orgB, U.ownerB.id, QA_KEY);
  check(del.ok && (await configForClient(clientB)).get(QA_KEY) === undefined, `deleteCredential removes ${QA_KEY} and the cached configuration at once`, del.ok ? undefined : del.error);
}

async function guardChecks() {
  section("Member-change guards (guardMemberChange)");
  const owner = { userId: U.ownerB.id, role: "owner" as OrgRole }, adm = { userId: U.adminB.id, role: "admin" as OrgRole };
  const cases: [string, { userId: string; role: OrgRole }, QaUser, { role?: OrgRole; remove?: boolean; deactivate?: boolean }, boolean][] = [
    ["ownerB demotes itself", owner, U.ownerB, { role: "admin" }, false],
    ["ownerB removes itself", owner, U.ownerB, { remove: true }, false],
    ["adminB makes itself owner (self-escalation)", adm, U.adminB, { role: "owner" }, false],
    ["adminB makes memberB an owner", adm, U.memberB, { role: "owner" }, false],
    ["adminB demotes the owner", adm, U.ownerB, { role: "member" }, false],
    ["adminB removes the owner", adm, U.ownerB, { remove: true }, false],
    ["adminB deactivates the owner", adm, U.ownerB, { deactivate: true }, false],
    ["another owner demotes the last owner", { userId: U.adminB.id, role: "owner" }, U.ownerB, { role: "admin" }, false],
    ["another owner removes the last owner", { userId: U.adminB.id, role: "owner" }, U.ownerB, { remove: true }, false],
    ["another owner deactivates the last owner", { userId: U.adminB.id, role: "owner" }, U.ownerB, { deactivate: true }, false],
    ["adminB makes memberB a viewer", adm, U.memberB, { role: "viewer" }, true],
    ["adminB makes memberB an admin", adm, U.memberB, { role: "admin" }, true],
    ["ownerB makes adminB an owner", owner, U.adminB, { role: "owner" }, true],
  ];
  for (const [what, actor, target, next, allowed] of cases) {
    const msg = await guardMemberChange(admin, orgB, actor, target.id, next);
    check(allowed ? msg === null : typeof msg === "string", `${allowed ? "allowed" : "refused"}: ${what}`, msg ?? "allowed");
  }
  try {
    await admin.from("organization_members").update({ role: "owner" }).eq("organization_id", orgB).eq("user_id", U.adminB.id);
    const msg = await guardMemberChange(admin, orgB, owner, U.adminB.id, { role: "admin" });
    check(msg === null, "allowed: with two owners, ownerB demotes the other owner", msg ?? "allowed");
    await admin.from("organization_members").update({ status: "deactivated" }).eq("organization_id", orgB).eq("user_id", U.adminB.id);
    const msg2 = await guardMemberChange(admin, orgB, owner, U.adminB.id, { remove: true });
    if (msg2 === null) report("PASS", "allowed: removing a deactivated owner while another owner is active");
    else report("WARN", "removing a deactivated owner while another owner is active is refused (over-strict, not a security issue)", msg2);
  } finally {
    await admin.from("organization_members").update({ role: "admin", status: "active" }).eq("organization_id", orgB).eq("user_id", U.adminB.id);
  }
}

/* ------------------------------------------------------------------------------------------------ other helpers */
type Members = typeof import("@/lib/org/members");
type Invitations = typeof import("@/lib/org/invitations");
type Clients = typeof import("@/lib/org/clients");
type Branding = typeof import("@/lib/org/branding");
type Spend = typeof import("@/lib/org/spend");
type Budget = typeof import("@/lib/dataforseo/budget");
type Tests = typeof import("@/lib/org/tests");

async function aMember(): Promise<{ id: string; role: string; status: string }> {
  const rows = await svc("organization_members", "user_id, role, status", (q) => q.eq("organization_id", orgA.id).order("created_at"));
  const r = rows[0];
  return { id: String(r?.user_id ?? ""), role: String(r?.role ?? ""), status: String(r?.status ?? "") };
}

async function membersChecks() {
  section("Members (src/lib/org/members.ts)");
  const { mod: m, why } = await optional<Members>("@/lib/org/members");
  if (!m) { report("SKIP", "members helpers", why); return; }
  const owner = { userId: U.ownerB.id, role: "owner" as OrgRole };
  const list = await m.listMembers(admin, orgB);
  const memberRow = list.find((x) => x.userId === U.memberB.id);
  check(sameSet(list.map((x) => x.userId), [U.ownerB.id, U.adminB.id, U.memberB.id]).ok && list.every((x) => x.email === Object.values(U).find((u) => u.id === x.userId)?.email)
    && memberRow?.clients.length === 1 && memberRow.clients[0].id === clientB, "listMembers(B): exactly B's three members, their emails and memberB's one client",
  describe(list.map((x) => x.userId)));
  const listA = await m.listMembers(admin, orgA.id);
  check(!listA.some((x) => Object.values(U).some((u) => u.id === x.userId)), "listMembers(A) has none of the test users", `${listA.length} members`);
  check(sameSet([...await m.orgClientIds(admin, orgB)], await bClients()).ok, "orgClientIds(B): exactly B's clients");
  const access = await m.orgClientAccess(admin, orgB);
  const allB = new Set(await bClients());
  check(access.every((a) => allB.has(a.client_id)), "orgClientAccess(B): only rows of B's clients", `${access.length} rows`);

  const aM = await aMember();
  const cross = await m.setMemberClientAccess(admin, orgB, owner, U.memberB.id, [{ clientId: clientA, role: "viewer" }]);
  const { data: leak } = await admin.from("client_members").select("role").eq("client_id", clientA).eq("user_id", U.memberB.id).maybeSingle();
  check(!cross.ok && !leak, "setMemberClientAccess(B) can't give access to a client of organization A", cross.ok ? "accepted" : cross.error);
  const b2 = (await bClients()).find((id) => id !== clientB)!;
  const widen = await m.setMemberClientAccess(admin, orgB, owner, U.memberB.id, [{ clientId: clientB, role: "viewer" }, { clientId: b2, role: "admin" }]);
  const sees = await seen(U.memberB, "clients", "id", (r) => String(r.id));
  check(widen.ok && sameSet(sees.keys, [clientB, b2]).ok, "setMemberClientAccess(B) grants B's own clients (memberB then reads exactly those)", widen.ok ? describe(sees.keys) : widen.error);
  const narrow = await m.setMemberClientAccess(admin, orgB, owner, U.memberB.id, [{ clientId: clientB, role: "viewer" }]);
  check(narrow.ok && sameSet((await seen(U.memberB, "clients", "id", (r) => String(r.id))).keys, [clientB]).ok, "…and takes them away again", narrow.ok ? undefined : narrow.error);

  const before = await aMember();
  const r1 = await m.changeMemberRole(admin, orgB, owner, aM.id, "viewer");
  const r2 = await m.removeMember(admin, orgB, owner, aM.id);
  const r3 = await m.setMemberStatus(admin, orgB, owner, aM.id, "deactivated");
  const after = await aMember();
  check(!r1.ok && !r2.ok && !r3.ok && after.role === before.role && after.status === before.status, `organization B's member actions on a member of ${orgA.name} are refused`, [r1, r2, r3].map((r) => (r.ok ? "ACCEPTED" : "refused")).join(", "));
  const esc = await m.changeMemberRole(admin, orgB, { userId: U.adminB.id, role: "admin" }, U.memberB.id, "owner");
  check(!esc.ok, "changeMemberRole: an admin can't make someone owner", esc.ok ? "accepted" : esc.error);
  const self = await m.setMemberStatus(admin, orgB, owner, U.ownerB.id, "deactivated");
  check(!self.ok, "setMemberStatus: ownerB can't deactivate itself", self.ok ? "accepted" : self.error);
  const off = await m.setMemberStatus(admin, orgB, owner, U.memberB.id, "deactivated");
  const offView = await seen(U.memberB, "clients", "id", (r) => String(r.id));
  const on = await m.setMemberStatus(admin, orgB, owner, U.memberB.id, "active");
  const onView = await seen(U.memberB, "clients", "id", (r) => String(r.id));
  check(off.ok && on.ok && !offView.keys.length && sameSet(onView.keys, [clientB]).ok, "setMemberStatus deactivates and reactivates memberB (row-level security follows at once)", `${offView.keys.length} clients while deactivated, ${onView.keys.length} after`);
}

async function invitationChecks() {
  section("Invitations (src/lib/org/invitations.ts)");
  const { mod: inv, why } = await optional<Invitations>("@/lib/org/invitations");
  if (!inv) { report("SKIP", "invitation helpers", why); return; }
  const owner = { userId: U.ownerB.id, role: "owner" as OrgRole };
  const open = await inv.listInvitations(admin, orgB);
  check(sameSet(open.map((i) => i.id), [inviteB]).ok, "listInvitations(B): only organization B's invitation", describe(open.map((i) => i.id)));
  // refusals only (an accepted request would send an email or create an account)
  const cross = await inv.createInvitation(admin, orgB, owner, { email: `qa-orgs-${RUN}-x@example.test`, role: "viewer", clientAccess: [{ clientId: clientA, role: "viewer" }] });
  check(!cross.ok, "createInvitation(B) can't grant a client of organization A", cross.ok ? "accepted" : cross.error);
  const byMember = await inv.createInvitation(admin, orgB, { userId: U.memberB.id, role: "member" }, { email: `qa-orgs-${RUN}-y@example.test`, role: "viewer", clientAccess: [] });
  const ownerByAdmin = await inv.createInvitation(admin, orgB, { userId: U.adminB.id, role: "admin" }, { email: `qa-orgs-${RUN}-z@example.test`, role: "owner", clientAccess: [] });
  check(!byMember.ok && !ownerByAdmin.ok, "a team member can't invite; an admin can't invite an owner", [byMember, ownerByAdmin].map((r) => (r.ok ? "ACCEPTED" : r.error)).join(" / "));
  const revA = await inv.revokeInvitation(admin, orgA.id, owner, inviteB);
  const stillOpen = (await admin.from("organization_invitations").select("revoked_at").eq("id", inviteB).single()).data?.revoked_at === null;
  check(!revA.ok && stillOpen, "an invitation id of B used with organization A's id is refused", revA.ok ? "accepted" : revA.error);

  const view = await inv.findInvitation(admin, inviteToken);
  const aNames = new Set((await svc("clients", "name", (q) => q.eq("id", clientA))).map((r) => r.name as string));
  check(view?.orgId === orgB && !(view?.clients ?? []).some((c) => aNames.has(c.name)), "findInvitation: the page shows organization B and none of organization A's client names (tampered invitation)", `${view?.clients.length ?? 0} clients shown`);

  const expiredToken = randomBytes(32).toString("base64url");
  SECRETS.add(expiredToken);
  await admin.from("organization_invitations").insert({ organization_id: orgB, email: U.outsider.email, role: "admin", token_hash: sha256(expiredToken), invited_by: U.ownerB.id, expires_at: new Date(Date.now() - 60_000).toISOString() });
  const expired = await inv.acceptInvitation(admin, expiredToken, { id: U.outsider.id, email: U.outsider.email });
  const wrong = await inv.acceptInvitation(admin, inviteToken, { id: U.outsider.id, email: U.outsider.email });
  // the invited address passed along with another account's id: the account's own email must decide
  const spoofed = await inv.acceptInvitation(admin, inviteToken, { id: U.outsider.id, email: U.inviteeB.email });
  check(!expired.ok && !wrong.ok && !spoofed.ok && !(await admin.from("organization_members").select("role").eq("organization_id", orgB).eq("user_id", U.outsider.id).maybeSingle()).data,
    "acceptInvitation refuses an expired link, a link for another email, and another account claiming the invited email", [expired, wrong, spoofed].map((r) => (r.ok ? "ACCEPTED" : r.error.slice(0, 45))).join(" / "));
  const ok = await inv.acceptInvitation(admin, inviteToken, { id: U.inviteeB.id, email: U.inviteeB.email });
  const grants = await svc("client_members", "client_id, role", (q) => q.eq("user_id", U.inviteeB.id));
  const sees = await seen(U.inviteeB, "clients", "id", (r) => String(r.id));
  check(ok.ok && ok.orgId === orgB && ok.role === "viewer" && sameSet(grants.map((g) => String(g.client_id)), [clientB]).ok && sameSet(sees.keys, [clientB]).ok,
    "acceptInvitation joins inviteeB to organization B with client B only (the client of organization A in the invitation is ignored)", ok.ok ? `grants: ${describe(grants.map((g) => String(g.client_id)))}` : ok.error);
  const again = await inv.acceptInvitation(admin, inviteToken, { id: U.inviteeB.id, email: U.inviteeB.email });
  check(!again.ok, "an invitation link works once", again.ok ? "accepted twice" : again.error);
}

async function clientsChecks() {
  section("Clients (src/lib/org/clients.ts)");
  const { mod: c, why } = await optional<Clients>("@/lib/org/clients");
  if (!c) { report("SKIP", "client helpers", why); return; }
  const owner = { userId: U.ownerB.id, role: "owner" as OrgRole };
  const list = await c.listOrgClients(admin, orgB);
  check(sameSet(list.map((x) => x.id), await bClients()).ok, "listOrgClients(B): exactly organization B's clients", describe(list.map((x) => x.id)));
  const a = (await svc("clients", "name, timezone, default_range_days, archived_at", (q) => q.eq("id", clientA)))[0];
  // the same values as client A has, so even a wrongly accepted call couldn't change it
  const same = { name: String(a.name), timezone: String(a.timezone), defaultRangeDays: Number(a.default_range_days) as 7 | 30 | 90 };
  const up = await c.updateOrgClient(admin, orgB, owner, clientA, same);
  const arch = await c.setClientArchived(admin, orgB, owner, clientA, Boolean(a.archived_at));
  const acc = await c.setClientAccess(admin, orgB, owner, clientA, [{ userId: U.memberB.id, role: "viewer" }]);
  const { data: leak } = await admin.from("client_members").select("role").eq("client_id", clientA).eq("user_id", U.memberB.id).maybeSingle();
  check(!up.ok && !arch.ok && !acc.ok && !leak, `organization B's client actions on a client of ${orgA.name} are refused`, [up, arch, acc].map((r) => (r.ok ? "ACCEPTED" : "refused")).join(", "));
  const aM = await aMember();
  const foreign = await c.setClientAccess(admin, orgB, owner, clientB, [{ userId: U.outsider.id, role: "viewer" }]);
  const foreignA = await c.setClientAccess(admin, orgB, owner, clientB, [{ userId: aM.id, role: "viewer" }]);
  check(!foreign.ok && !foreignA.ok, "setClientAccess(B) only grants members of organization B", [foreign, foreignA].map((r) => (r.ok ? "ACCEPTED" : "refused")).join(", "));
  const inA = await c.createOrgClient(U.ownerB.sb, admin, orgA.id, owner, { name: `QA Client Cattempt ${RUN}`, timezone: "UTC", defaultRangeDays: 30 });
  if (inA.ok) created.clients.push(inA.id);
  const byMember = await c.createOrgClient(U.memberB.sb, admin, orgB, { userId: U.memberB.id, role: "member" }, { name: `QA Client Cmember ${RUN}`, timezone: "UTC", defaultRangeDays: 30 });
  if (byMember.ok) created.clients.push(byMember.id);
  check(!inA.ok && !byMember.ok, `createOrgClient refuses organization A for ownerB, and team members`, [inA, byMember].map((r) => (r.ok ? "ACCEPTED" : r.error)).join(" / "));
}

/** a valid 16×16 PNG */
function png16(): Uint8Array<ArrayBuffer> {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(16 * 49, 0x99); for (let y = 0; y < 16; y++) raw[y * 49] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

async function brandingChecks() {
  section("Branding and logo files (src/lib/org/branding.ts, bucket org-assets)");
  const { mod: b, why } = await optional<Branding>("@/lib/org/branding");
  if (!b) { report("SKIP", "branding helpers", why); return; }
  const up = await b.uploadBrandAsset(admin, orgB, "logo", new Blob([png16()], { type: "image/png" }));
  if (up.ok) created.files.push(up.asset.path);
  check(up.ok && up.asset.path.startsWith(`${orgB}/`), "uploadBrandAsset(B) stores the logo in organization B's own folder", up.ok ? up.asset.path.replace(orgB, "<B>") : up.error);
  if (!up.ok) return;
  const brandName = `QA Brand ${STAMP.slice(8)}`;
  const input = { displayName: brandName, logo: { path: up.asset.path, w: 16, h: 16 }, colors: { primary: "#123456", secondary: null, accent: null }, report: { header: "QA", footer: "" }, company: { name: "", address: "", website: "", email: "", phone: "" }, loginBranding: true };
  const aBefore = JSON.stringify((await admin.from("organizations").select("branding").eq("id", orgA.id).single()).data?.branding ?? null);
  const saved = await b.saveBranding(admin, orgB, U.ownerB.id, input);
  check(saved.ok, "saveBranding(B) saves organization B's branding", saved.ok ? undefined : saved.error);
  const readB = await b.readBranding(admin, orgB), readA = await b.readBranding(admin, orgA.id);
  const aAfter = JSON.stringify((await admin.from("organizations").select("branding").eq("id", orgA.id).single()).data?.branding ?? null);
  check(readB.displayName === brandName && readB.logo?.path === up.asset.path && readA.displayName !== brandName && !JSON.stringify(readA).includes(orgB) && aBefore === aAfter,
    "B reads its own branding; organization A's branding is unchanged and never shows B's", `A: ${readA.displayName ?? "default name"}`);
  const foreignPath = `${orgA.id}/logo-qa${STAMP.slice(8)}-0123abcd.png`;
  const steal = await b.saveBranding(admin, orgB, U.ownerB.id, { ...input, logo: { path: foreignPath, w: 16, h: 16 } });
  const climb = await b.saveBranding(admin, orgB, U.ownerB.id, { ...input, logo: { path: `${orgB}/../${foreignPath}`, w: 16, h: 16 } });
  check(!steal.ok && !climb.ok, "saveBranding(B) refuses a logo path in organization A's folder (also with ../)", [steal, climb].map((r) => (r.ok ? "ACCEPTED" : "refused")).join(", "));
  check(b.parseBranding({ logo: { path: foreignPath } }, orgB).logo === null, "a stored path into another organization's folder is ignored when read");
  const pubB = await b.getPublicBranding(orgB), pubA = await b.getPublicBranding(orgA.id);
  check(pubB.custom && pubB.name === brandName && pubA.name !== brandName, "public (sign-in page) branding: B's for B, never for A", `A: ${pubA.name}`);

  // the bucket is public for reading; writing is server-only
  const evil = `${orgB}/logo-qa${STAMP.slice(8)}-deadbeef.png`;
  for (const role of ["outsider", "ownerB"] as const) {
    const { error } = await U[role].sb.storage.from(BUCKET).upload(evil, png16(), { contentType: "image/png", upsert: true });
    if (!error) created.files.push(evil);
    check(Boolean(error), `${role} can't upload into the org-assets bucket directly`, error ? error.message.slice(0, 80) : "uploaded");
  }
  await U.outsider.sb.storage.from(BUCKET).remove([up.asset.path]);
  const { data: still } = await admin.storage.from(BUCKET).list(orgB, { limit: 100 });
  check((still ?? []).some((f) => up.asset.path.endsWith(f.name)), "outsider can't delete organization B's logo");
  const { data: listed } = await U.outsider.sb.storage.from(BUCKET).list(orgB, { limit: 100 });
  if ((listed ?? []).length) report("WARN", "outsider can list organization B's logo files (public assets, names only)", `${listed?.length} files`);
  else report("PASS", "outsider can't list organization B's files");
}

async function spendChecks() {
  section("Spend (src/lib/dataforseo/budget.ts, src/lib/org/spend.ts)");
  const cost = 0.004321, ai = 0.00123;
  const { mod: budget, why } = await optional<Budget>("@/lib/dataforseo/budget");
  if (!budget) { report("SKIP", "budget helpers", why); return; }
  const aBefore = await budget.orgSpend(admin, { orgId: orgA.id });
  await budget.recordSpend(admin, clientB, "qa_orgs_check", cost, "manual");
  await admin.from("ai_usage_events").insert({ client_id: clientB, feature: "fanout", model: "claude-opus-5-5", cost_usd: ai });
  const [bSpend, aAfter, cSpend, hist] = await Promise.all([
    budget.orgSpend(admin, { orgId: orgB }), budget.orgSpend(admin, { orgId: orgA.id }), budget.clientSpend(admin, clientB), budget.spendHistory(admin, { orgId: orgB }),
  ]);
  check(Math.abs(bSpend - cost) < 1e-9 && Math.abs(cSpend - cost) < 1e-9, "orgSpend(B) and clientSpend(B) count only organization B's call", `B ${bSpend}`);
  check(Math.abs(aAfter - aBefore - cost) > 1e-9, "orgSpend(A) doesn't include organization B's call", `A changed by ${(aAfter - aBefore).toFixed(6)}`);
  check(hist.length === 1 && Math.abs(hist[0].total - cost) < 1e-9, "spendHistory(B) shows only organization B's day", plural(hist.length, "day"));

  const aSettings = await budget.getSettings(admin, { orgId: orgA.id });
  const bSettings = await budget.getSettings(admin, { orgId: orgB });
  if (pendingMigration(37)) report("SKIP", "per-organization DataForSEO settings", "migration 037 isn't applied yet");
  else {
    check(bSettings.dailyBudget === budget.DEFAULT_DAILY_BUDGET && bSettings.autoRefresh, "organization B starts with the default DataForSEO limit, not organization A's", `A ${aSettings.dailyBudget}/${aSettings.autoRefresh}, B ${bSettings.dailyBudget}/${bSettings.autoRefresh}`);
    const s = await budget.saveSettings(admin, orgB, { dailyBudget: 2.34, autoRefresh: false }, U.ownerB.id);
    const [b2, a2] = await Promise.all([budget.getSettings(admin, { orgId: orgB }), budget.getSettings(admin, { orgId: orgA.id })]);
    check(!s.error && b2.dailyBudget === 2.34 && !b2.autoRefresh && a2.dailyBudget === aSettings.dailyBudget && a2.autoRefresh === aSettings.autoRefresh, "saveSettings(B) changes organization B's limit only", s.error ?? `A ${a2.dailyBudget}/${a2.autoRefresh}`);
  }
  const runs = budget.runBudgets(admin);
  const ofB = await runs.of(clientB);
  const skipped = runs.skipped().find((s) => s.organization === orgB);
  check(ofB === null && Boolean(skipped), "scheduled DataForSEO runs skip organization B (no credentials of its own) instead of using A's account", skipped?.reason ?? "not skipped");

  const { mod: spend, why: whySpend } = await optional<Spend>("@/lib/org/spend");
  if (!spend) { report("SKIP", "organization spend reports", whySpend); return; }
  const allB = new Set(await bClients());
  const tools = await spend.toolsSpendReport(admin, orgB, "7d");
  check(tools.org.id === orgB && tools.clients.every((c) => allB.has(c.id)) && Math.abs(tools.kpis.range - (cost + ai)) < 1e-6,
    "toolsSpendReport(B): organization B's clients and spend only", `${tools.clients.length} clients, ${tools.kpis.range} spent`);
  const aiRep = await spend.aiSpendReport(admin, orgB, "7d");
  check(aiRep.clients.every((c) => allB.has(c.id)) && Math.abs(aiRep.kpis.range - ai) < 1e-6, "aiSpendReport(B): organization B's Claude spend only", `${aiRep.kpis.range} spent`);
  const csv = await spend.spendRecords(admin, orgB, "tools", "7d");
  const names = new Set((await svc("clients", "name", (q) => q.eq("organization_id", orgB))).map((r) => r.name as string));
  check(csv.rows.length === 1 && csv.rows.every((r) => names.has(String(r[3]))), "spendRecords(B) exports organization B's records only", plural(csv.rows.length, "row"));
}

async function integrationChecks() {
  section("Integrations use the client's own organization (no network calls)");
  const { mod: t, why } = await optional<Tests>("@/lib/org/tests");
  if (!t) report("SKIP", "connection tests", why);
  else {
    const ids = INTEGRATIONS.filter((i) => t.hasTest(i.id)).map((i) => i.id);
    const results = await Promise.all(ids.map(async (id) => ({ id, r: await t.testIntegration(orgB, id) })));
    const used = results.filter((x) => x.r.status !== "error" || !/^Add /.test(x.r.message));
    check(!used.length, `connection tests for organization B stop at "add the credentials first" (${ids.length} integrations)`, used.length ? `${used.map((x) => `${x.id}: ${x.r.message.slice(0, 60)}`).join("; ")}` : undefined);
  }
  const { mod: ai, why: whyAi } = await optional<typeof import("@/lib/ai/claude")>("@/lib/ai/claude");
  if (!ai) report("SKIP", "Claude client", whyAi);
  else {
    let e: unknown = null;
    try { await ai.anthropicFor(clientB); } catch (x) { e = x; }
    const [uB, uA] = await Promise.all([ai.aiUnavailable(clientB), ai.aiUnavailable(clientA)]);
    check(isConfigError(e) && Boolean(uB) && uA === null, "Claude: client B has no key (ConfigError); client A has its organization's", `B: ${e instanceof Error ? e.name : "no error"}, ${uB?.slice(0, 50)}; A: ${uA ?? "available"}`);
  }
  const { mod: dfs, why: whyDfs } = await optional<typeof import("@/lib/dataforseo/client")>("@/lib/dataforseo/client");
  if (!dfs) report("SKIP", "DataForSEO client", whyDfs);
  else {
    let e: unknown = null;
    try { await dfs.dfsPost(clientB, "/appendix/user_data", {}); } catch (x) { e = x; }
    const [cB, cA] = await Promise.all([dfs.dfsConfigured(clientB), dfs.dfsConfigured(clientA)]);
    check(e instanceof dfs.DfsError && e.kind === "config" && !cB && cA, "DataForSEO: a call for client B stops before the request (no account); client A is set up", e instanceof Error ? e.message.slice(0, 70) : "no error");
  }
  const { mod: comp, why: whyComp } = await optional<typeof import("@/lib/composio/client")>("@/lib/composio/client");
  if (!comp) report("SKIP", "Composio client", whyComp);
  else {
    let e: unknown = null;
    try { await comp.composioForClient(clientB); } catch (x) { e = x; }
    check(isConfigError(e), "Composio: client B gets a ConfigError, never organization A's project", e instanceof Error ? `${e.name}: ${e.message.slice(0, 60)}` : "a Composio client was made");
  }
}

/* ------------------------------------------------------------------------------------------------ sweeps */
async function tableSweep() {
  section("Every table: organization A's rows stay invisible (as each user)");
  const schema = await restSchema();
  const tables = Object.keys(schema.paths).filter((p) => p !== "/" && !p.startsWith("/rpc/")).map((p) => p.slice(1)).sort();
  const allB = new Set(await bClients());
  const qaIds = new Set(Object.values(U).map((u) => u.id));
  const allowedClients: Record<string, Set<string>> = { ownerB: allB, adminB: allB, memberB: new Set([clientB]), outsider: new Set() };
  const allowedOrgs: Record<string, Set<string>> = { ownerB: new Set([orgB]), adminB: new Set([orgB]), memberB: new Set([orgB]), outsider: new Set() };
  const leaks = new Map<string, Set<string>>();
  const leak = (t: string, role: string) => leaks.set(t, (leaks.get(t) ?? new Set()).add(role));
  let targeted = 0, scanned = 0, timeouts = 0;
  await pool(tables, 6, async (t) => {
    const props = schema.definitions[t]?.properties ?? {};
    const cols = Object.keys(props);
    const pk = cols.filter((c) => /primary key/i.test(props[c]?.description ?? ""));
    const owner = t === "clients" ? { col: "id", kind: "client" } : t === "organizations" ? { col: "id", kind: "org" }
      : cols.includes("organization_id") ? { col: "organization_id", kind: "org" } : cols.includes("client_id") ? { col: "client_id", kind: "client" }
        : cols.includes("user_id") ? { col: "user_id", kind: "user" } : cols.includes("owner_user_id") ? { col: "owner_user_id", kind: "user" } : { col: "", kind: "global" };
    // one row that isn't organization B's (service role), asked for by primary key as each user
    let q = admin.from(t).select([...new Set([...pk, ...(owner.col ? [owner.col] : [])])].join(",") || "*").limit(1);
    if (owner.kind === "client") q = q.not(owner.col, "in", `(${[...allB].join(",")})`);
    if (owner.kind === "org") q = q.neq(owner.col, orgB);
    if (owner.kind === "user") q = q.not(owner.col, "in", `(${[...qaIds].join(",")})`);
    const { data: other } = await q;
    const row = (other as unknown as Row[] | null)?.[0];
    const { count } = await admin.from(t).select("*", { count: "planned", head: true });
    const small = (count ?? 0) <= 5000;
    for (const role of VIEWERS) {
      const sb = U[role].sb;
      if (row && pk.length) {
        targeted++;
        const { data, error } = await sb.from(t).select(pk.join(",")).match(Object.fromEntries(pk.map((c) => [c, row[c]]))).limit(1);
        if (error?.code === "57014") timeouts++;
        if ((data ?? []).length) leak(t, role);
      }
      if (small) {
        scanned++;
        const { data, error } = await sb.from(t).select(owner.col || pk[0] || "*").limit(200);
        if (error?.code === "57014") timeouts++;
        for (const r of (data ?? []) as unknown as Row[]) {
          const v = owner.col ? String(r[owner.col] ?? "") : "";
          const fine = owner.kind === "client" ? allowedClients[role].has(v) : owner.kind === "org" ? allowedOrgs[role].has(v) : owner.kind === "user" ? qaIds.has(v) : false;
          if (!fine) { leak(t, role); break; }
        }
      }
    }
  });
  // with --allow-pending, a leak in a table that a pending migration changes is a warning (it may be the fix)
  const pendingSql = [...pending].map((f) => ({ f, sql: readFileSync(`${MIGRATIONS}/${f}`, "utf8") }));
  let hard = 0;
  for (const [t, roles] of leaks) {
    const fix = pendingSql.find((p) => new RegExp(`\\b${t}\\b`).test(p.sql));
    const status: Status = fix && ARGS.has("--allow-pending") ? "WARN" : "FAIL";
    if (status === "FAIL") hard++;
    report(status, `${t}: rows of another organization (or with no organization) readable`, `by ${[...roles].join(", ")}${fix ? `; ${fix.f}, not applied yet, changes this table` : ""}`);
  }
  check(!hard, `${tables.length} tables: no row of organization A visible to ${VIEWERS.join(", ")}`,
    `${targeted} primary-key lookups of A's rows, ${scanned} full reads of small tables${timeouts ? `, ${timeouts} statement timeouts (no rows returned)` : ""}`);
}

async function rpcSweep() {
  section("Every database function: organization A's data stays invisible (as outsider and ownerB)");
  const schema = await restSchema();
  // these write when they run: create_client is tested above; the sync queue ones are never called here
  const WRITES = new Set(["create_client", "enqueue_daily_sync", "claim_next_sync_job"]);
  const SERVICE_ONLY = new Set(["find_user_id_by_email", "org_member_directory", "user_directory", "enqueue_daily_sync", "claim_next_sync_job", "finish_sync_job", "requeue_stale_sync_jobs"]);
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  const firstOfLastMonth = (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10); })();
  const aMemberId = (await aMember()).id;
  // always passed: the target, and values that make a write function a no-op even if it wrongly ran
  // (an unknown job type is rejected after the membership check, no job id matches, nothing is stale for 2 years)
  const FIXED: Record<string, () => unknown> = {
    p_client_id: () => clientA, p_org: () => orgA.id, p_ids: () => [aMemberId], p_email: () => U.outsider.email,
    p_job_id: () => randomUUID(), p_job_type: () => "qa-invalid", p_outcome: () => "error", p_minutes: () => 1_000_000,
  };
  const TEXT: Record<string, string> = { p_provider: "gsc", p_channel: "all", p_dim: "country", p_granularity: "day", p_kind: "all", p_search_type: "web", p_device: "all", p_country: "all" };
  const argsFor = (fn: string): Record<string, unknown> => {
    const s = rpcSchema(schema, fn), req = new Set(s?.required ?? []), out: Record<string, unknown> = {};
    for (const [p, prop] of Object.entries(s?.properties ?? {})) {
      const t = (prop.format ?? prop.type ?? "").toLowerCase();
      const v = FIXED[p] ? FIXED[p]() : t === "date" ? (p === "p_month" ? firstOfLastMonth : p === "p_end" ? day(1) : day(28)) : !req.has(p) ? undefined
        : /int|numeric|number/.test(t) ? 10 : t === "boolean" ? false : t.endsWith("[]") || t === "array" ? ["qa"] : /json/.test(t) ? {} : TEXT[p] ?? "qa";
      if (v !== undefined) out[p] = v;
    }
    return out;
  };
  const hasData = (v: unknown): boolean => (typeof v === "number" ? v !== 0 : v === true ? true : Array.isArray(v) ? v.some(hasData) : v && typeof v === "object" ? Object.values(v).some(hasData) : false);
  const fns = Object.keys(schema.paths).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)).filter((f) => !WRITES.has(f)).sort();
  const problems: string[] = [];
  let refused = 0, empty = 0;
  await pool(fns, 4, async (fn) => {
    const args = argsFor(fn);
    for (const role of ["outsider", "ownerB"] as const) {
      const { data, error } = await U[role].sb.rpc(fn, args);
      if (error) { refused++; if (fn === "enqueue_sync_job" && !isDenied(error)) problems.push(`${fn}: answered "${error.message.slice(0, 40)}" instead of refusing ${role} for client A`); continue; }
      if (SERVICE_ONLY.has(fn)) { problems.push(`${fn}: service-only, but ${role} can call it`); continue; }
      if (!hasData(data)) { empty++; continue; }
      const { data: svcData } = await admin.rpc(fn, args);
      if (JSON.stringify(svcData) === JSON.stringify(data)) problems.push(`${fn}: ${role} receives organization A's data`);
      else empty++;
    }
  });
  for (const p of problems) report("FAIL", p);
  check(!problems.length, `${fns.length} functions called with ${orgA.name}'s client or organization: no data returned`, `${refused} calls refused, ${empty} answered without A's data; not called: ${[...WRITES].join(", ")}`);
}

async function anonymousChecks() {
  section("Signed-out (anonymous) caller");
  const tables = ["organizations", "organization_members", "organization_invitations", "organization_credentials", "organization_audit_log", "platform_admins", "clients", ...(pendingMigration(37) ? [] : ["organization_dfs_settings"])];
  const open: string[] = [];
  for (const t of tables) { const { data, error } = await anon.from(t).select("*").limit(1); if (!error && (data ?? []).length) open.push(t); }
  check(!open.length, `anonymous callers read none of ${tables.length} organization tables`, open.length ? `readable: ${open.join(", ")}` : undefined);
  const calls = await Promise.all([
    anon.rpc("create_client", { p_name: `QA Client anon ${RUN}` }), anon.rpc("org_role", { p_org: orgB }), anon.rpc("is_org_member", { p_org: orgB }),
    anon.rpc("org_member_directory", { p_org: orgA.id }),
  ]);
  for (const c of calls) if (typeof c.data === "string" && c.data.length === 36) created.clients.push(c.data);
  check(calls.every((c) => Boolean(c.error)), "anonymous callers can't run create_client, org_role, is_org_member or org_member_directory", calls.map((c) => (c.error ? c.error.code : "ANSWERED")).join(", "));
}

/* ================================================================================================== cleanup */
async function filesOf(org: string): Promise<string[]> {
  const { data } = await admin.storage.from(BUCKET).list(org, { limit: 1000 });
  return (data ?? []).filter((f) => f.id).map((f) => `${org}/${f.name}`);
}
/** Deletes test data in dependency order and says what went. Only rows this script made (names, ids, markers) are touched. */
async function removeTestData(t: { users: string[]; orgs: string[]; clients: string[]; files: string[] }): Promise<string[]> {
  const said: string[] = [];
  const files = [...new Set([...t.files, ...(await Promise.all(t.orgs.map(filesOf))).flat()])];
  if (files.length) { const { error } = await admin.storage.from(BUCKET).remove(files); said.push(error ? `couldn't remove ${files.length} files: ${error.message}` : `${files.length} uploaded file${files.length === 1 ? "" : "s"}`); }
  const inOrgs = t.orgs.length ? (await admin.from("clients").select("id").in("organization_id", t.orgs)).data ?? [] : [];
  const clients = [...new Set([...t.clients, ...inOrgs.map((c) => c.id as string)])];
  if (clients.length) { const { error } = await admin.from("clients").delete().in("id", clients); said.push(error ? `couldn't remove clients: ${error.message}` : `${clients.length} client${clients.length === 1 ? "" : "s"} (with their client data)`); }
  for (const org of t.orgs) {
    const n = async (table: string) => (await admin.from(table).select("organization_id", { count: "exact", head: true }).eq("organization_id", org)).count ?? 0;
    const [m, i, c, a] = await Promise.all(["organization_members", "organization_invitations", "organization_credentials", "organization_audit_log"].map(n));
    const { data: o } = await admin.from("organizations").select("name").eq("id", org).maybeSingle();
    if (!o) continue;
    const { error } = await admin.from("organizations").delete().eq("id", org);
    said.push(error ? `couldn't remove organization "${o.name}": ${error.message}` : `organization "${o.name}" with ${m} members, ${i} invitations, ${c} credentials, ${a} audit entries`);
  }
  let users = 0;
  for (const id of t.users) { const { error } = await admin.auth.admin.deleteUser(id); if (error) said.push(`couldn't remove user ${labels.get(id) ?? id}: ${error.message}`); else users++; }
  if (users) said.push(`${users} test user${users === 1 ? "" : "s"}`);
  return said;
}

async function allUsers(): Promise<{ id: string; email?: string }[]> {
  const out: { id: string; email?: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing users: ${error.message}`);
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}
const stampAge = (s: string) => Date.now() - Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
/** Test data of earlier, interrupted runs (older than 30 minutes, or everything with --cleanup). */
async function removeLeftovers(everything: boolean) {
  const old = (stamp: string) => everything || stampAge(stamp) > 30 * 60_000;
  const users = (await allUsers()).filter((u) => { const m = QA_EMAIL.exec(u.email ?? ""); return m && old(m[1]); }).map((u) => u.id);
  const { data: orgs } = await admin.from("organizations").select("id, name, description").or("name.like.QA Org B *,name.like.QA should-not-exist *");
  const orgIds = (orgs ?? []).filter((o) => { const m = QA_ORG.exec(o.name as string) ?? /^QA should-not-exist (\d{14})-/.exec(o.name as string); return m && (o.description === MARKER || /^QA should-not-exist/.test(o.name as string)) && old(m[1]); }).map((o) => o.id as string);
  const { data: cl } = await admin.from("clients").select("id, name").like("name", "QA Client %");
  const clientIds = (cl ?? []).filter((c) => { const m = QA_CLIENT.exec(c.name as string); return m && old(m[1]); }).map((c) => c.id as string);
  if (!users.length && !orgIds.length && !clientIds.length) { if (everything) console.log("Nothing left behind by earlier runs."); return; }
  const said = await removeTestData({ users, orgs: orgIds, clients: clientIds, files: [] });
  report("WARN", "removed what an earlier, interrupted run left behind", said.join("; "));
}

let cleaning: Promise<void> | null = null;
function cleanup(): Promise<void> {
  return (cleaning ??= (async () => {
    section("Cleanup");
    try {
      // anything this run may have written outside organization B (only if a check failed), removed while the actors still exist
      const qaIds = Object.values(U).map((u) => u.id);
      if (orgA.id && qaIds.length) {
        const { data: stray } = await admin.from("organization_audit_log").delete().eq("organization_id", orgA.id).in("actor_user_id", qaIds).select("id");
        if ((stray ?? []).length) console.log(`removed ${stray?.length} audit entries written to ${orgA.name} by test users`);
        if (!qaKeyInAEarlier) { const { data: k } = await admin.from("organization_credentials").delete().eq("organization_id", orgA.id).eq("key", QA_KEY).select("key"); if ((k ?? []).length) console.log(`removed a ${QA_KEY} stored in ${orgA.name}`); }
      }
      const { data: named } = await admin.from("clients").select("id").like("name", `% ${RUN}%`);
      const said = await removeTestData({ ...created, clients: [...created.clients, ...(named ?? []).map((c) => c.id as string)] });
      for (const s of said) console.log(`removed ${s}`);
      // nothing of this run may remain
      const left: string[] = [];
      const u = (await allUsers()).filter((x) => (x.email ?? "").includes(RUN)).length;
      if (u) left.push(`${u} users`);
      const { count: o } = await admin.from("organizations").select("id", { count: "exact", head: true }).in("id", created.orgs.length ? created.orgs : [randomUUID()]);
      if (o) left.push(`${o} organizations`);
      const { count: c } = await admin.from("clients").select("id", { count: "exact", head: true }).like("name", `% ${RUN}%`);
      if (c) left.push(`${c} clients`);
      const f = orgB ? (await filesOf(orgB)).length : 0;
      if (f) left.push(`${f} files`);
      check(!left.length, "all test data removed (users, organization B, its clients, credentials, invitations, audit entries, files)", left.length ? `left: ${left.join(", ")}` : undefined);
    } catch (e) {
      report("FAIL", "cleanup", `${errText(e)}: run again with --cleanup`);
    }
  })());
}

/* ================================================================================================== run */
process.once("SIGINT", () => {
  interrupted = true;
  console.log("\nInterrupted: cleaning up… (if anything is left, run again with --cleanup)");
  cleanup().finally(() => process.exit(130));
});

if (ARGS.has("--cleanup")) {
  await removeLeftovers(true);
  process.exit(counts.FAIL ? 1 : 0);
}
console.log(`Organization isolation check, run ${RUN}`);
pending = await checkMigrations();
await loadOrgA();
await removeLeftovers(false);
try {
  await createFixtures();
  await step("create_client checks", createClientChecks);
  await step("visibility checks", visibilityChecks);
  await step("write checks", writeChecks);
  await step("deactivation checks", deactivationChecks);
  await step("credential checks", credentialChecks);
  await step("guard checks", guardChecks);
  await step("members checks", membersChecks);
  await step("clients checks", clientsChecks);
  await step("branding checks", brandingChecks);
  await step("spend checks", spendChecks);
  await step("integration checks", integrationChecks);
  await step("table sweep", tableSweep);
  await step("function sweep", rpcSweep);
  await step("anonymous checks", anonymousChecks);
  await step("invitation checks", invitationChecks);
} catch (e) {
  report("FAIL", "the run stopped", errText(e));
} finally {
  await cleanup();
}
console.log(`\n${counts.PASS} passed, ${counts.FAIL} failed, ${counts.WARN} warnings, ${counts.SKIP} skipped in ${Math.round((Date.now() - started) / 1000)} s`);
if (failures.length) console.log(`\nFailed:\n${failures.join("\n")}`);
process.exit(counts.FAIL ? 1 : 0);
