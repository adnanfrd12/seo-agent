// Access-control audit: for every table exposed through the API, what can an anonymous caller read?
// Usage: node scripts/audit-rls.mjs     (reads .env; uses the service key only to LIST tables and to plant nothing)
// Pass = anonymous access is denied or returns nothing. Tenant isolation between two signed-in users
// is enforced by the is_client_member() policies in supabase/migrations and needs two real sessions to test.
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; }));
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const spec = await (await fetch(`${base}/rest/v1/`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })).json();
const tables = Object.keys(spec.paths ?? {}).filter((p) => !p.startsWith("/rpc/") && p !== "/").map((p) => p.slice(1)).sort();

let bad = 0;
for (const t of tables) {
  const r = await fetch(`${base}/rest/v1/${t}?select=*&limit=3`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  const body = await r.json().catch(() => null);
  const leaked = r.ok && Array.isArray(body) && body.length > 0;
  const state = !r.ok ? `denied (${r.status})` : leaked ? `LEAK: ${body.length} rows visible` : "empty";
  if (leaked) bad++;
  console.log(`${leaked ? "FAIL" : "ok  "} ${t.padEnd(32)} ${state}`);
}
// functions an anonymous caller must not be able to run
const rpcs = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5));
let open = 0;
for (const f of rpcs) {
  const r = await fetch(`${base}/rest/v1/rpc/${f}`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "content-type": "application/json" }, body: "{}" });
  const text = await r.text();
  // 404/PGRST202 = the function isn't even visible to the anon role (no EXECUTE grant), which is a refusal too
  const refused = [401, 403, 404].includes(r.status) || /permission denied|forbidden|not authenticated|JWT/i.test(text);
  if (!refused) { open++; console.log(`WARN rpc ${f}: anon call answered ${r.status} (${text.slice(0, 70)})`); }
}
console.log(`\n${tables.length} tables checked, ${bad} readable by anonymous callers; ${rpcs.length} functions checked, ${open} answered an anonymous call without refusing.`);
process.exit(bad ? 1 : 0);
