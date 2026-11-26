/**
 * Pure parts of the security audit (no network, no server-only import) so they can be unit tested:
 * header / cookie / HTML / DNS-record analysis, the score and the version comparisons.
 */
import { fixFor, type FixCtx, type HostKind, type SecFix } from "./security-fixes";

export type Severity = "high" | "medium" | "low" | "info";
export type SecStatus = "pass" | "fail" | "warn" | "unknown";
export type SecGroup = "HTTPS" | "Headers" | "Exposure" | "Code" | "WordPress" | "Email";
export interface SecCheck { id: string; title: string; group: SecGroup; severity: Severity; status: SecStatus; evidence: string; why: string; fix: SecFix }

export const SEV_ORDER: Severity[] = ["high", "medium", "low", "info"];
const DEDUCT: Record<Severity, number> = { high: 25, medium: 6, low: 2, info: 0 };

/** 100 minus 25 / 6 / 2 per failed high / medium / low check (half for a warning); unknown checks cost nothing. */
export function securityScore(checks: Pick<SecCheck, "severity" | "status">[]): number {
  const lost = checks.reduce((s, c) => s + (c.status === "fail" ? DEDUCT[c.severity] : c.status === "warn" ? DEDUCT[c.severity] / 2 : 0), 0);
  return Math.max(0, Math.round(100 - lost));
}

export function hostKind(server: string | null, cfRay: boolean): HostKind {
  const s = (server ?? "").toLowerCase();
  if (cfRay || s.includes("cloudflare")) return "cloudflare";
  if (s.includes("litespeed")) return "litespeed";
  if (s.includes("apache")) return "apache";
  if (s.includes("nginx") || s.includes("openresty")) return "nginx";
  if (s.includes("iis")) return "iis";
  return "other";
}

/** -1 / 0 / 1 comparing dotted versions ("3.5" < "3.5.1"). */
export function cmpVersion(a: string, b: string): number {
  const x = a.split(".").map((n) => parseInt(n, 10) || 0), y = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

/** Library versions referenced by the page's script/link tags. */
export function libraries(html: string): { name: string; version: string; src: string }[] {
  const out = new Map<string, { name: string; version: string; src: string }>();
  const urls = [...html.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const u of urls) {
    const low = u.toLowerCase();
    const ver = (re: RegExp) => low.match(re)?.[1] ?? null;
    let name: string | null = null, v: string | null = null;
    if (/jquery-migrate/.test(low)) continue;
    if (/jquery-ui|jquery\.ui|jqueryui/.test(low)) { name = "jQuery UI"; v = ver(/jquery-?ui[/@-](\d+\.\d+(?:\.\d+)?)/) ?? ver(/jqueryui\/(\d+\.\d+(?:\.\d+)?)/); }
    else if (/jquery/.test(low)) { name = "jQuery"; v = ver(/jquery[/@-](\d+\.\d+\.\d+)/) ?? ver(/jquery(?:\.min|\.slim|\.slim\.min)?\.js\?ver=(\d+\.\d+(?:\.\d+)?)/); }
    else if (/bootstrap/.test(low) && /\.js|\.css/.test(low)) { name = "Bootstrap"; v = ver(/bootstrap[/@-](\d+\.\d+\.\d+)/) ?? ver(/bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)\?ver=(\d+\.\d+(?:\.\d+)?)/); }
    if (name && v && !out.has(name)) out.set(name, { name, version: v, src: u.slice(0, 160) });
  }
  return [...out.values()];
}

/** Known-vulnerable ranges (public CVEs): jQuery < 3.5.0 (CVE-2020-11022/11023), Bootstrap < 3.4.1 and 4.0-4.3.0 (CVE-2019-8331), jQuery UI < 1.13.0 (CVE-2021-41182/3/4). */
export function vulnerableLib(l: { name: string; version: string }): string | null {
  if (l.name === "jQuery" && cmpVersion(l.version, "3.5.0") < 0) return "XSS bugs fixed in 3.5.0 (CVE-2020-11022, CVE-2020-11023)";
  if (l.name === "Bootstrap" && (cmpVersion(l.version, "3.4.1") < 0 || (cmpVersion(l.version, "4.0.0") >= 0 && cmpVersion(l.version, "4.3.1") < 0))) return "XSS bug fixed in 3.4.1 / 4.3.1 (CVE-2019-8331)";
  if (l.name === "jQuery UI" && cmpVersion(l.version, "1.13.0") < 0) return "XSS bugs fixed in 1.13.0 (CVE-2021-41182/41183/41184)";
  return null;
}

/** http:// resources on an https page: active (scripts, styles, iframes, form targets) and passive (media). */
export function mixedContent(html: string): { active: string[]; passive: string[] } {
  const grab = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
  const active = [
    ...grab(/<script\b[^>]*\ssrc=["'](http:\/\/[^"']+)/gi),
    ...grab(/<iframe\b[^>]*\ssrc=["'](http:\/\/[^"']+)/gi),
    ...grab(/<link\b(?=[^>]*rel=["']?stylesheet)[^>]*\shref=["'](http:\/\/[^"']+)/gi),
    ...grab(/<form\b[^>]*\saction=["'](http:\/\/[^"']+)/gi),
  ];
  const passive = [...grab(/<(?:img|source|video|audio)\b[^>]*\ssrc=["'](http:\/\/[^"']+)/gi)];
  return { active: [...new Set(active)], passive: [...new Set(passive)] };
}

export interface CookieIssue { name: string; missing: string[] }
const SESSIONISH = /sess|sid|auth|token|login|wordpress_|wp-settings|jwt|csrf|xsrf/i;
/** Flags each Set-Cookie header that lacks Secure (https), HttpOnly (session-like names) or SameSite. */
export function cookieIssues(setCookies: string[], https: boolean): CookieIssue[] {
  const out: CookieIssue[] = [];
  for (const c of setCookies) {
    const [pair, ...attrs] = c.split(";");
    const name = pair.split("=")[0].trim();
    if (!name) continue;
    const a = attrs.map((x) => x.trim().toLowerCase());
    // deleting a cookie (expired date / max-age=0) is harmless
    if (a.some((x) => x === "max-age=0" || /^expires=.*19[7-9]\d/.test(x))) continue;
    const missing: string[] = [];
    if (https && !a.includes("secure")) missing.push("Secure");
    if (SESSIONISH.test(name) && !a.includes("httponly")) missing.push("HttpOnly");
    if (!a.some((x) => x.startsWith("samesite="))) missing.push("SameSite");
    if (missing.length) out.push({ name, missing });
  }
  return out;
}

export function spfStatus(txt: string[]): { status: SecStatus; evidence: string; severity: Severity } {
  const spf = txt.filter((t) => /^v=spf1\b/i.test(t.trim()));
  if (!spf.length) return { status: "fail", severity: "medium", evidence: "No SPF record: any server can send mail that claims to be from this domain." };
  if (spf.length > 1) return { status: "fail", severity: "medium", evidence: `${spf.length} SPF records found; receivers treat that as an error (only one is allowed).` };
  const r = spf[0];
  if (/[+]all\b/i.test(r)) return { status: "fail", severity: "high", evidence: `SPF ends in +all, which authorises every server on the internet: "${r.slice(0, 160)}"` };
  if (/[?]all\b/i.test(r) || !/[~-]all\b|redirect=/i.test(r)) return { status: "warn", severity: "medium", evidence: `SPF doesn't end in ~all or -all, so it protects nothing: "${r.slice(0, 160)}"` };
  return { status: "pass", severity: "medium", evidence: `"${r.slice(0, 200)}"` };
}

export function dmarcStatus(txt: string[]): { status: SecStatus; evidence: string } {
  const d = txt.find((t) => /^v=DMARC1\b/i.test(t.trim()));
  if (!d) return { status: "fail", evidence: "No DMARC record at _dmarc: receivers don't know to reject mail that spoofs this domain." };
  const p = d.match(/\bp\s*=\s*(\w+)/i)?.[1]?.toLowerCase();
  if (p === "reject" || p === "quarantine") return { status: "pass", evidence: `Policy p=${p}: "${d.slice(0, 200)}"` };
  return { status: "warn", evidence: `Policy p=${p ?? "missing"} only monitors; spoofed mail is still delivered: "${d.slice(0, 200)}"` };
}

/** Each check's fixed title, group, base severity and one-line "why it matters". */
export const CHECKS: Record<string, { title: string; group: SecGroup; severity: Severity; why: string }> = {
  https_redirect: { title: "HTTPS enforced", group: "HTTPS", severity: "high", why: "Visitors who type the address without https:// must be moved to the encrypted site." },
  tls_cert: { title: "Valid TLS certificate", group: "HTTPS", severity: "high", why: "An invalid certificate shows a full-page browser warning and lets traffic be intercepted." },
  tls_expiry: { title: "Certificate expiry", group: "HTTPS", severity: "high", why: "An expired certificate takes the site offline for most visitors." },
  hsts: { title: "HSTS (Strict-Transport-Security)", group: "HTTPS", severity: "medium", why: "Tells browsers to always use HTTPS, so the first visit can't be downgraded." },
  mixed_content: { title: "Mixed content on the home page", group: "HTTPS", severity: "high", why: "Insecure scripts or styles on an https page are blocked or can be tampered with." },
  csp: { title: "Content-Security-Policy", group: "Headers", severity: "medium", why: "Limits where scripts may load from: the main defence against injected scripts (XSS)." },
  frame_options: { title: "Clickjacking protection", group: "Headers", severity: "medium", why: "Stops other sites from loading your pages in a hidden frame to trick clicks." },
  content_type_options: { title: "X-Content-Type-Options", group: "Headers", severity: "low", why: "Stops browsers from treating uploaded files as scripts." },
  referrer_policy: { title: "Referrer-Policy", group: "Headers", severity: "low", why: "Controls how much of your page address is sent to other sites." },
  permissions_policy: { title: "Permissions-Policy", group: "Headers", severity: "low", why: "Switches off camera, microphone and location access the site doesn't need." },
  server_disclosure: { title: "Software version disclosure", group: "Headers", severity: "low", why: "Version numbers in headers tell attackers which known bugs to try." },
  cookies: { title: "Cookie security flags", group: "Headers", severity: "medium", why: "Cookies without Secure / HttpOnly / SameSite can leak or be stolen by scripts." },
  cors: { title: "Cross-origin access (CORS)", group: "Headers", severity: "medium", why: "An open CORS policy lets any website read your pages through a visitor's browser." },
  exposed_files: { title: "Sensitive files publicly reachable", group: "Exposure", severity: "high", why: "Config files, backups and source control folders can leak passwords and the whole site." },
  directory_listing: { title: "Directory listing", group: "Exposure", severity: "medium", why: "A browsable uploads folder exposes every file, including private documents." },
  security_txt: { title: "security.txt", group: "Exposure", severity: "info", why: "Tells researchers how to report a problem to you instead of publishing it." },
  outdated_js: { title: "Outdated JavaScript libraries", group: "Code", severity: "medium", why: "Old jQuery / Bootstrap versions have published cross-site-scripting bugs." },
  spf: { title: "SPF email record", group: "Email", severity: "medium", why: "Without SPF, scammers can send email that appears to come from your domain." },
  dmarc: { title: "DMARC email policy", group: "Email", severity: "medium", why: "DMARC tells mailbox providers to reject email that fakes your domain." },
  wp_core_outdated: { title: "WordPress up to date", group: "WordPress", severity: "high", why: "Most WordPress hacks use bugs that newer releases already fixed." },
  wp_version: { title: "WordPress version hidden", group: "WordPress", severity: "low", why: "A visible version lets bots pick matching exploits automatically." },
  wp_readme: { title: "WordPress readme.html", group: "WordPress", severity: "low", why: "Confirms the site runs WordPress to automated scanners." },
  wp_user_enum: { title: "Username discovery", group: "WordPress", severity: "medium", why: "Listed usernames are half of what a password-guessing attack needs." },
  wp_xmlrpc: { title: "XML-RPC enabled", group: "WordPress", severity: "medium", why: "XML-RPC lets attackers try hundreds of passwords in a single request." },
};

export function makeCheck(id: string, status: SecStatus, evidence: string, ctx: FixCtx, severity?: Severity): SecCheck {
  const d = CHECKS[id];
  return { id, title: d.title, group: d.group, severity: severity ?? d.severity, status, evidence, why: d.why, fix: fixFor(id, ctx) };
}

/** Failing first (by severity), then warnings, unknown, passes. */
export function sortChecks(xs: SecCheck[]): SecCheck[] {
  const rank: Record<SecStatus, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };
  return [...xs].sort((a, b) => rank[a.status] - rank[b.status] || SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
}
