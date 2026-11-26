import "server-only";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_UA } from "@/lib/blog/wordpress";
import type { FixCtx } from "./security-fixes";
import {
  cmpVersion, cookieIssues, dmarcStatus, hostKind, libraries, makeCheck, mixedContent, securityScore, sortChecks, spfStatus, vulnerableLib,
  type SecCheck, type Severity,
} from "./security-scan";

/**
 * Passive website security audit: only the ordinary GET requests a browser would make (at most MAX_REQUESTS
 * to the client's site, each with a timeout), one TLS handshake, two DNS-over-HTTPS lookups and, for WordPress,
 * one call to api.wordpress.org for the latest version. Nothing is exploited, guessed or brute-forced; a
 * sensitive file only counts as exposed when it answers 200 AND its content matches what that file looks like
 * (so "soft 404" pages that answer 200 for everything are not reported). Contents of exposed files are never stored.
 *
 * Stored in dfs_cache (endpoint "security_audit", cost 0): params_hash "latest" = the newest audit plus a short
 * score history; params_hash "ai" = the newest AI fix plan.
 */
export const SEC_ENDPOINT = "security_audit";
export const SEC_EVERY_DAYS = 30;
const MAX_REQUESTS = 30;
const TIMEOUT = 12_000;

export interface SecHistory { at: string; score: number; failing: number }
export interface SecAudit {
  checkedAt: string; domain: string; finalUrl: string | null; wordpress: boolean; wpVersion: string | null; server: string | null;
  requests: number; score: number | null; counts: Record<Severity, number>; passed: number; total: number;
  checks: SecCheck[]; error?: string; history: SecHistory[];
}
export interface SecAi { at: string; auditAt: string; text: string; model: string; cost: number }

interface Got { status: number | null; headers: Headers | null; body: string; url: string; location: string | null; error?: string }

/** One bounded request: no redirects followed, body read only up to maxBytes (latin1 so magic bytes survive). */
function requester(budget: { left: number }) {
  return async (url: string, opts: { maxBytes?: number; headers?: Record<string, string> } = {}): Promise<Got> => {
    if (budget.left <= 0) return { status: null, headers: null, body: "", url, location: null, error: "request limit reached" };
    budget.left--;
    try {
      const res = await fetch(url, { headers: { "user-agent": BOT_UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...opts.headers }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT) });
      const max = opts.maxBytes ?? 8192;
      let body = "";
      if (res.body) {
        const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let n = 0;
        while (n < max) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
        await reader.cancel().catch(() => {});
        body = Buffer.concat(chunks).subarray(0, max).toString("latin1");
      }
      return { status: res.status, headers: res.headers, body, url, location: res.headers.get("location") };
    } catch (e) {
      return { status: null, headers: null, body: "", url, location: null, error: e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message).slice(0, 120) : "failed" };
    }
  };
}

function tlsInfo(host: string): Promise<{ authorized: boolean; error: string | null; validTo: string | null; issuer: string | null; protocol: string | null; names: string | null } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Awaited<ReturnType<typeof tlsInfo>>) => { if (!done) { done = true; resolve(v); } };
    try {
      const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
        const c = s.getPeerCertificate();
        const issuer = c?.issuer ? (Array.isArray(c.issuer.O) ? c.issuer.O[0] : c.issuer.O) ?? (Array.isArray(c.issuer.CN) ? c.issuer.CN[0] : c.issuer.CN) ?? null : null;
        finish({ authorized: s.authorized, error: s.authorizationError ? String(s.authorizationError) : null, validTo: c?.valid_to ?? null, issuer, protocol: s.getProtocol() ?? null, names: c?.subjectaltname?.slice(0, 200) ?? null });
        s.end();
      });
      s.on("error", (e) => finish({ authorized: false, error: e.message.slice(0, 120), validTo: null, issuer: null, protocol: null, names: null }));
      s.on("timeout", () => { s.destroy(); finish(null); });
    } catch { finish(null); }
  });
}

async function dohTxt(name: string): Promise<string[] | null> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
    if (j.Status !== 0 && j.Status !== 3) return null; // 3 = NXDOMAIN: simply no record
    return (j.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } catch { return null; }
}

async function latestWordPress(): Promise<string | null> {
  try {
    const r = await fetch("https://api.wordpress.org/core/version-check/1.7/", { headers: { "user-agent": BOT_UA }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const j = (await r.json()) as { offers?: { current?: string }[] };
    return j.offers?.[0]?.current ?? null;
  } catch { return null; }
}

const mask = (s: string) => (s.length <= 2 ? "**" : `${s[0]}${"*".repeat(Math.min(6, s.length - 2))}${s.at(-1)}`);
const lower = (h: Headers | null, k: string) => h?.get(k) ?? null;

/** Runs every check against https://{domain}/ and returns the audit (not stored). */
export async function auditSite(domain: string, opts: { previous?: SecHistory[] } = {}): Promise<SecAudit> {
  const budget = { left: MAX_REQUESTS };
  const get = requester(budget);
  const checkedAt = new Date().toISOString();
  const empty = (error: string): SecAudit => ({ checkedAt, domain, finalUrl: null, wordpress: false, wpVersion: null, server: null, requests: MAX_REQUESTS - budget.left, score: null, counts: { high: 0, medium: 0, low: 0, info: 0 }, passed: 0, total: 0, checks: [], error, history: opts.previous ?? [] });

  // 1. home page over https, following redirects by hand (cookies from every hop on this site are collected)
  const probeOrigin = "https://security-check.invalid";
  let cur = `https://${domain}/`, home: Got | null = null;
  const setCookies: string[] = [];
  for (let hop = 0; hop < 5; hop++) {
    const r = await get(cur, { maxBytes: 1_500_000, headers: { origin: probeOrigin } });
    setCookies.push(...(r.headers?.getSetCookie?.() ?? []));
    if (r.status && r.status >= 300 && r.status < 400 && r.location) { cur = new URL(r.location, cur).toString(); continue; }
    home = r; break;
  }
  if (!home || home.status == null) {
    // maybe the site only answers on www.
    if (!domain.startsWith("www.")) { const w = await get(`https://www.${domain}/`, { maxBytes: 1_500_000 }); if (w.status && w.status < 400) return auditSite(`www.${domain}`, opts).then((a) => ({ ...a, domain })); }
    return empty(`The website didn't answer over HTTPS (${home?.error ?? "too many redirects"}).`);
  }
  const final = new URL(home.url);
  const host = final.hostname;
  const apex = host.replace(/^www\./, "");
  const origin = final.origin;
  const https = final.protocol === "https:";
  const h = home.headers;
  const html = home.body;
  const server = [lower(h, "server"), lower(h, "x-powered-by")].filter(Boolean).join(" · ") || null;
  const wpVersionMeta = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']WordPress\s+([\d.]+)/i)?.[1] ?? null;
  const wordpress = Boolean(wpVersionMeta) || /\/wp-content\/|\/wp-includes\/|api\.w\.org/i.test(html);
  const wpVersion = wpVersionMeta ?? html.match(/wp-includes\/css\/dist\/block-library\/style(?:\.min)?\.css\?ver=(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? null;
  const ctx: FixCtx = { wp: wordpress, host: hostKind(lower(h, "server"), Boolean(lower(h, "cf-ray"))), domain: apex };
  const checks: SecCheck[] = [];
  const add = (...a: Parameters<typeof makeCheck>) => checks.push(makeCheck(...a));

  // 2. everything else in parallel (small batches so the site isn't hammered)
  const sensitive = [
    { path: "/.git/HEAD", label: ".git folder (source code and history)", match: (b: string) => /^(ref: refs\/|[0-9a-f]{40}\s*$)/.test(b.trim()) },
    { path: "/.env", label: ".env file (passwords / API keys)", match: (b: string) => !/<html|<!doctype/i.test(b) && (b.match(/^\s*[A-Z][A-Z0-9_]{2,}\s*=/gm)?.length ?? 0) >= 2 },
    { path: "/wp-config.php.bak", label: "wp-config.php backup (database password)", match: (b: string) => /DB_(NAME|USER|PASSWORD)|<\?php/.test(b) },
    { path: "/backup.zip", label: "backup.zip (site backup)", match: (b: string) => b.startsWith("PK\x03\x04") },
    { path: "/phpinfo.php", label: "phpinfo.php (server configuration)", match: (b: string) => /<title>phpinfo\(\)|<title>PHP \d|PHP Version <\/|phpinfo\(\)/i.test(b) },
    { path: "/.DS_Store", label: ".DS_Store (folder listing)", match: (b: string) => b.slice(4, 8) === "Bud1" },
    ...(wordpress ? [{ path: "/wp-content/debug.log", label: "wp-content/debug.log (error log)", match: (b: string) => /PHP (Fatal error|Warning|Notice|Parse error|Deprecated)/.test(b) }] : []),
  ];
  const [http1, tlsI, spfTxt, dmarcTxt, wpLatest, ...rest] = await Promise.all([
    get(`http://${host}/`, { maxBytes: 2048 }),
    https ? tlsInfo(host) : Promise.resolve(null),
    dohTxt(apex), dohTxt(`_dmarc.${apex}`),
    wordpress && wpVersion ? latestWordPress() : Promise.resolve(null),
    get(`${origin}/.well-known/security.txt`, { maxBytes: 4096 }),
    ...sensitive.slice(0, 3).map((s) => get(origin + s.path, { headers: { range: "bytes=0-8191" } })),
  ]);
  const [secTxt, ...sensA] = rest as Got[];
  const sensB = await Promise.all(sensitive.slice(3).map((s) => get(origin + s.path, { headers: { range: "bytes=0-8191" } })));
  const sensRes = [...sensA, ...sensB];
  const wpRes = wordpress ? await Promise.all([
    get(`${origin}/wp-json/wp/v2/users`, { maxBytes: 65_536, headers: { accept: "application/json" } }),
    get(`${origin}/?author=1`, { maxBytes: 1024 }),
    get(`${origin}/xmlrpc.php`, { maxBytes: 2048 }),
    get(`${origin}/readme.html`, { maxBytes: 8192 }),
    get(`${origin}/wp-content/uploads/`, { maxBytes: 16_384 }),
  ]) : null;

  // HTTPS enforced: follow http:// redirects (max 3 more hops)
  {
    const firstStatus = http1.status;
    let r = http1, hops = 0;
    while (r.status && r.status >= 300 && r.status < 400 && r.location && hops < 3) {
      const next = new URL(r.location, r.url).toString();
      if (next.startsWith("https://")) { r = { ...r, url: next }; break; }
      r = await get(next, { maxBytes: 2048 }); hops++;
    }
    const endsHttps = r.url.startsWith("https://");
    if (http1.status == null) add("https_redirect", "warn", `http://${host}/ doesn't answer (${http1.error ?? "no response"}); visitors who type the address without https may get an error.`, ctx, "low");
    else if (endsHttps) add("https_redirect", firstStatus === 301 || firstStatus === 308 ? "pass" : "warn", `http://${host}/ → ${r.url} (HTTP ${firstStatus}${firstStatus === 301 || firstStatus === 308 ? ", permanent" : ", temporary redirect: use 301"})`, ctx, firstStatus === 301 || firstStatus === 308 ? undefined : "low");
    else add("https_redirect", "fail", `http://${host}/ answers HTTP ${r.status ?? "?"} without moving visitors to https.`, ctx);
  }

  // TLS certificate
  if (!https) { add("tls_cert", "fail", `The home page ends on ${home.url}, not https.`, ctx); add("tls_expiry", "unknown", "No HTTPS certificate to check.", ctx); }
  else if (!tlsI) { add("tls_cert", "unknown", "The TLS handshake timed out.", ctx); add("tls_expiry", "unknown", "The TLS handshake timed out.", ctx); }
  else {
    const old = tlsI.protocol && /TLSv1(\.1)?$/.test(tlsI.protocol);
    add("tls_cert", tlsI.authorized && !old ? "pass" : "fail",
      tlsI.authorized ? `Trusted certificate from ${tlsI.issuer ?? "unknown issuer"}, ${tlsI.protocol ?? "TLS"}${old ? " (outdated protocol: TLS 1.2+ required)" : ""}.` : `Browsers won't trust it: ${tlsI.error ?? "invalid certificate"}${tlsI.names ? ` (covers ${tlsI.names})` : ""}.`, ctx);
    const days = tlsI.validTo ? Math.floor((Date.parse(tlsI.validTo) - Date.now()) / 86_400_000) : null;
    if (days == null || Number.isNaN(days)) add("tls_expiry", "unknown", "Expiry date not readable.", ctx);
    else add("tls_expiry", days < 14 ? "fail" : days < 30 ? "warn" : "pass", days < 0 ? `Expired ${-days} days ago (${tlsI.validTo}).` : `Expires in ${days} days (${new Date(Date.parse(tlsI.validTo!)).toISOString().slice(0, 10)}).`, ctx);
  }

  // HSTS
  {
    const v = lower(h, "strict-transport-security");
    const age = Number(v?.match(/max-age\s*=\s*"?(\d+)/i)?.[1] ?? NaN);
    if (!https) add("hsts", "unknown", "Site isn't served over HTTPS.", ctx);
    else if (!v) add("hsts", "fail", "No Strict-Transport-Security header on the home page.", ctx);
    else if (!(age >= 15_552_000)) add("hsts", "warn", `max-age is ${Number.isFinite(age) ? `${Math.round(age / 86400)} days` : "missing"}; use at least 180 days: "${v}"`, ctx);
    else add("hsts", "pass", `"${v}"`, ctx);
  }

  // mixed content
  if (https) {
    const m = mixedContent(html);
    if (m.active.length) add("mixed_content", "fail", `${m.active.length} insecure script/style/frame/form address(es), e.g. ${m.active.slice(0, 3).join(", ")}${m.passive.length ? `; plus ${m.passive.length} http:// image(s)` : ""}.`, ctx);
    else if (m.passive.length) add("mixed_content", "warn", `${m.passive.length} http:// image/media address(es), e.g. ${m.passive.slice(0, 3).join(", ")}.`, ctx, "medium");
    else add("mixed_content", "pass", "No http:// scripts, styles, frames, forms or images on the home page.", ctx);
  }

  // headers
  const csp = lower(h, "content-security-policy"), cspRo = lower(h, "content-security-policy-report-only");
  add("csp", csp ? "pass" : cspRo ? "warn" : "fail", csp ? `"${csp.slice(0, 220)}${csp.length > 220 ? "…" : ""}"` : cspRo ? "Only a report-only policy is set; nothing is enforced yet." : "No Content-Security-Policy header.", ctx);
  const xfo = lower(h, "x-frame-options");
  const fa = /frame-ancestors/i.test(csp ?? "");
  add("frame_options", xfo && /deny|sameorigin/i.test(xfo) || fa ? "pass" : "fail", xfo ? `X-Frame-Options: ${xfo}${fa ? " and CSP frame-ancestors" : ""}` : fa ? "CSP frame-ancestors is set." : "Neither X-Frame-Options nor CSP frame-ancestors is set.", ctx);
  const xcto = lower(h, "x-content-type-options");
  add("content_type_options", /nosniff/i.test(xcto ?? "") ? "pass" : "fail", xcto ? `X-Content-Type-Options: ${xcto}` : "Header missing.", ctx);
  const rp = lower(h, "referrer-policy");
  add("referrer_policy", rp ? (/unsafe-url/i.test(rp) ? "fail" : "pass") : "warn", rp ? `Referrer-Policy: ${rp}` : "Header missing (browsers fall back to strict-origin-when-cross-origin).", ctx);
  const pp = lower(h, "permissions-policy");
  add("permissions_policy", pp ? "pass" : "warn", pp ? `"${pp.slice(0, 160)}"` : "Header missing.", ctx);
  {
    const parts = ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version"].map((k) => [k, lower(h, k)] as const).filter(([, v]) => v && /\d+\.\d+/.test(v));
    const php = (lower(h, "x-powered-by") ?? "").match(/PHP\/(\d+\.\d+)/i)?.[1];
    const eol = php && cmpVersion(php, "8.2") < 0;
    if (!parts.length) add("server_disclosure", "pass", server ? `Headers name the software without a version: ${server}` : "No Server / X-Powered-By version shown.", ctx);
    else add("server_disclosure", "fail", parts.map(([k, v]) => `${k}: ${v}`).join("; ") + (eol ? ` (PHP ${php} no longer gets security fixes)` : ""), ctx, eol ? "medium" : undefined);
  }
  {
    const issues = cookieIssues(setCookies, https);
    const serious = issues.filter((i) => i.missing.includes("Secure") || i.missing.includes("HttpOnly"));
    if (!setCookies.length) add("cookies", "pass", "The home page sets no cookies from the server (cookies set by scripts aren't visible to this check).", ctx);
    else if (!issues.length) add("cookies", "pass", `${setCookies.length} cookie(s), all with the right flags.`, ctx);
    else add("cookies", serious.length ? "fail" : "warn", issues.slice(0, 6).map((i) => `${i.name}: no ${i.missing.join(", ")}`).join("; "), ctx, serious.length ? undefined : "low");
  }
  {
    const acao = lower(h, "access-control-allow-origin"), cred = /true/i.test(lower(h, "access-control-allow-credentials") ?? "");
    if (!acao) add("cors", "pass", "No Access-Control-Allow-Origin header on the home page.", ctx);
    else if ((acao === probeOrigin || acao === "*") && cred) add("cors", "fail", `Access-Control-Allow-Origin: ${acao === probeOrigin ? "(any site, reflected)" : "*"} with Allow-Credentials: true.`, ctx, "high");
    else if (acao === probeOrigin) add("cors", "warn", "The site echoes back any Origin in Access-Control-Allow-Origin.", ctx, "low");
    else if (acao === "*") add("cors", "warn", "Access-Control-Allow-Origin: * on the HTML page (any site can read it).", ctx, "low");
    else add("cors", "pass", `Access-Control-Allow-Origin limited to ${acao}.`, ctx);
  }

  // exposure
  {
    const found = sensitive.filter((s, i) => (sensRes[i].status === 200 || sensRes[i].status === 206) && s.match(sensRes[i].body));
    const answered = sensRes.filter((r) => r.status != null).length;
    if (found.length) add("exposed_files", "fail", `Publicly downloadable: ${found.map((f) => `${f.path} (${f.label})`).join("; ")}. Contents were not stored.`, ctx);
    else if (!answered) add("exposed_files", "unknown", "The site didn't answer these requests.", ctx);
    else add("exposed_files", "pass", `Not reachable: ${sensitive.map((s) => s.path).join(", ")}.`, ctx);
  }
  if (wpRes) {
    const up = wpRes[4];
    add("directory_listing", up.status === 200 && /<title>\s*Index of \/|Directory listing for|\[To Parent Directory\]/i.test(up.body) ? "fail" : up.status == null ? "unknown" : "pass",
      up.status === 200 && /Index of \//i.test(up.body) ? "/wp-content/uploads/ shows a browsable file list." : `/wp-content/uploads/ answers HTTP ${up.status ?? "?"} without a file list.`, ctx);
  }
  add("security_txt", secTxt.status === 200 && /^\s*Contact:/im.test(secTxt.body) ? "pass" : "warn", secTxt.status === 200 && /^\s*Contact:/im.test(secTxt.body) ? `Found: ${secTxt.body.match(/^\s*Contact:.*$/im)![0].trim().slice(0, 120)}` : "/.well-known/security.txt not found.", ctx);

  // libraries
  {
    const libs = libraries(html);
    const bad = libs.map((l) => ({ ...l, why: vulnerableLib(l) })).filter((l) => l.why);
    if (bad.length) add("outdated_js", "fail", bad.map((l) => `${l.name} ${l.version}: ${l.why}`).join("; "), ctx);
    else add("outdated_js", "pass", libs.length ? `Current versions: ${libs.map((l) => `${l.name} ${l.version}`).join(", ")}.` : "No versioned jQuery / Bootstrap / jQuery UI found on the home page.", ctx);
  }

  // email DNS
  if (spfTxt == null) add("spf", "unknown", "DNS lookup failed.", ctx);
  else { const s = spfStatus(spfTxt); add("spf", s.status, s.evidence, ctx, s.severity); }
  if (dmarcTxt == null) add("dmarc", "unknown", "DNS lookup failed.", ctx);
  else { const d = dmarcStatus(dmarcTxt); add("dmarc", d.status, d.evidence, ctx); }

  // WordPress
  if (wpRes) {
    const [users, author, xmlrpc, readme] = wpRes;
    if (!wpVersion) add("wp_core_outdated", "unknown", "The version is hidden, so it can't be compared (good). Check Dashboard → Updates.", ctx);
    else if (!wpLatest) add("wp_core_outdated", "unknown", `WordPress ${wpVersion}; the latest version couldn't be read from wordpress.org.`, ctx);
    else {
      const behind = cmpVersion(wpVersion, wpLatest) < 0;
      const branchBehind = cmpVersion(wpVersion.split(".").slice(0, 2).join("."), wpLatest.split(".").slice(0, 2).join(".")) < 0;
      add("wp_core_outdated", behind ? "fail" : "pass", behind ? `WordPress ${wpVersion}; latest is ${wpLatest}.` : `WordPress ${wpVersion} is the latest release.`, ctx, behind && !branchBehind ? "high" : behind ? "medium" : undefined);
    }
    add("wp_version", wpVersionMeta ? "fail" : wpVersion ? "warn" : "pass", wpVersionMeta ? `<meta name="generator" content="WordPress ${wpVersionMeta}"> on the home page.` : wpVersion ? `Version ${wpVersion} visible in core file addresses (?ver=).` : "Version not shown on the home page.", ctx);
    add("wp_readme", readme.status === 200 && /wordpress/i.test(readme.body) ? "fail" : "pass", readme.status === 200 && /wordpress/i.test(readme.body) ? "/readme.html is public." : `/readme.html answers HTTP ${readme.status ?? "?"}.`, ctx);
    const list = (() => { try { const j = JSON.parse(users.body) as unknown; return Array.isArray(j) ? (j as { slug?: string }[]).filter((u) => u && typeof u.slug === "string") : []; } catch { return []; } })();
    const authorLoc = author.status && author.status >= 300 && author.status < 400 ? author.location : null;
    const authorSlug = authorLoc?.match(/\/author\/([^/?#]+)/i)?.[1] ?? null;
    const leaks = [
      users.status === 200 && list.length ? `/wp-json/wp/v2/users lists ${list.length} account(s) (e.g. ${mask(list[0].slug!)})` : null,
      authorSlug ? `/?author=1 redirects to /author/${mask(decodeURIComponent(authorSlug))}/` : null,
    ].filter(Boolean);
    add("wp_user_enum", leaks.length ? "fail" : "pass", leaks.length ? leaks.join("; ") + "." : `REST users endpoint answers HTTP ${users.status ?? "?"}; /?author=1 doesn't reveal a username.`, ctx);
    const rpcOn = xmlrpc.status === 405 && /XML-RPC server accepts POST requests only/i.test(xmlrpc.body) || (xmlrpc.status === 200 && /XML-RPC/i.test(xmlrpc.body));
    add("wp_xmlrpc", rpcOn ? "fail" : xmlrpc.status == null ? "unknown" : "pass", rpcOn ? "/xmlrpc.php is active (answers “XML-RPC server accepts POST requests only”)." : `/xmlrpc.php answers HTTP ${xmlrpc.status ?? "?"}.`, ctx);
  }

  const sorted = sortChecks(checks);
  const counted = sorted.filter((c) => c.status === "fail" || c.status === "warn");
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const c of counted) counts[c.severity]++;
  const score = securityScore(sorted);
  return {
    checkedAt, domain, finalUrl: home.url, wordpress, wpVersion, server, requests: MAX_REQUESTS - budget.left, score, counts,
    passed: sorted.filter((c) => c.status === "pass").length, total: sorted.length, checks: sorted,
    history: [{ at: checkedAt, score, failing: counted.length }, ...(opts.previous ?? [])].slice(0, 12),
  };
}

export async function loadSecurity(supabase: SupabaseClient, clientId: string): Promise<{ audit: SecAudit | null; ai: SecAi | null }> {
  const { data } = await supabase.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", SEC_ENDPOINT).in("params_hash", ["latest", "ai"]);
  const row = (k: string) => (data ?? []).find((r) => r.params_hash === k)?.data ?? null;
  return { audit: row("latest") as SecAudit | null, ai: row("ai") as SecAi | null };
}

/** Runs the audit for one client and stores it with the previous scores as history. */
export async function runSecurityAudit(admin: SupabaseClient, clientId: string, domain: string): Promise<SecAudit> {
  const { audit: prev } = await loadSecurity(admin, clientId);
  const audit = await auditSite(domain, { previous: prev?.history ?? [] });
  const { error } = await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: SEC_ENDPOINT, params_hash: "latest", params: { domain }, data: audit, row_count: audit.checks.length, cost: 0, fetched_at: audit.checkedAt }, { onConflict: "client_id,endpoint,params_hash" });
  if (error) throw new Error(`security audit not saved: ${error.message}`);
  return audit;
}

/** The client's website without writing anything: the saved research target, else a connected Bing / Search Console / Business Profile site. */
export async function siteDomain(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const { data: t } = await admin.from("research_targets").select("domain").eq("client_id", clientId).maybeSingle();
  if (t?.domain) return t.domain as string;
  const { data: res } = await admin.from("integration_resources").select("provider, external_id, metadata").eq("client_id", clientId).eq("is_selected", true);
  const host = (u: unknown) => { if (typeof u !== "string" || !u) return null; const raw = u.replace(/^sc-domain:/, ""); try { return new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase() || null; } catch { return null; } };
  const pick = (p: string, f: (r: { external_id: string; metadata: unknown }) => unknown) => (res ?? []).filter((r) => r.provider === p).map((r) => host(f(r))).find(Boolean) ?? null;
  return pick("bing", (r) => r.external_id) ?? pick("gsc", (r) => r.external_id) ?? pick("gbp", (r) => (r.metadata as { website?: unknown } | null)?.website);
}

/**
 * Cron step: audits clients that have a website but no audit yet (new clients first), then audits older than
 * SEC_EVERY_DAYS (a failed run is retried after 3 days). At most `max` clients and never past `deadline`.
 */
export async function runDueSecurityAudits(admin: SupabaseClient, opts: { deadline: number; max: number }) {
  const [{ data: clients }, { data: rows }] = await Promise.all([
    admin.from("clients").select("id").limit(5000),
    admin.from("dfs_cache").select("client_id, fetched_at, data->error").eq("endpoint", SEC_ENDPOINT).eq("params_hash", "latest").limit(5000),
  ]);
  const last = new Map((rows ?? []).map((r) => [r.client_id as string, { at: Date.parse(r.fetched_at as string), failed: Boolean((r as { error?: unknown }).error) }]));
  const due = (clients ?? []).map((c) => c.id as string).filter((id) => {
    const l = last.get(id);
    return !l || Date.now() - l.at > (l.failed ? 3 : SEC_EVERY_DAYS) * 86_400_000;
  }).sort((a, b) => (last.get(a)?.at ?? 0) - (last.get(b)?.at ?? 0));
  let ran = 0, firstRuns = 0;
  const errors: string[] = [];
  for (const id of due) {
    if (ran >= opts.max || Date.now() > opts.deadline - 60_000) break;
    const domain = await siteDomain(admin, id).catch(() => null);
    if (!domain) continue;
    try { const a = await runSecurityAudit(admin, id, domain); ran++; if (!last.has(id)) firstRuns++; if (a.error) errors.push(a.error); }
    catch (e) { errors.push(e instanceof Error ? e.message : "failed"); }
  }
  return { audited: ran, firstRuns, waiting: Math.max(0, due.length - ran), errors: [...new Set(errors)].slice(0, 3) };
}
