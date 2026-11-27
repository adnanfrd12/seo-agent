/**
 * Organization branding (white label), the client-safe half: the shape stored in organizations.branding, the
 * defaults (the SEO Insights look), validation, and the colour theme derived from an organization's colours.
 * The settings preview uses exactly these functions, so what it shows is what the dashboard, reports and sign-in
 * page render. Reading from the database (cached), saving and uploads live in ./branding.ts (server only).
 *
 * Unset fields always mean "the default": an organization that sets nothing looks exactly like SEO Insights.
 */

export const DEFAULT_BRAND_NAME = "SEO Insights";
export const BRAND_BUCKET = "org-assets";

export const BRAND_ASSET_KINDS = ["logo", "logoLight", "logoDark", "favicon"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];
export const BRAND_COLOR_KEYS = ["primary", "secondary", "accent"] as const;
export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];

/** An uploaded image in the public org-assets bucket (path = "<organization id>/<kind>-<stamp>-<random>.<ext>"). */
export interface BrandAsset { path: string; url: string; w: number | null; h: number | null }
export type BrandColors = Record<BrandColorKey, string | null>;
export interface BrandCompany { name: string; address: string; website: string; email: string; phone: string }

export interface Branding {
  /** platform name shown instead of "SEO Insights" (null = default) */
  displayName: string | null;
  /** main logo, used wherever no light/dark version is set */
  logo: BrandAsset | null;
  /** logo for light backgrounds (light mode, reports, sign-in page) */
  logoLight: BrandAsset | null;
  /** logo for dark backgrounds (dark mode) */
  logoDark: BrandAsset | null;
  favicon: BrandAsset | null;
  /** #RRGGBB or null (default). primary: buttons, links, selection; secondary: charts; accent: highlights */
  colors: BrandColors;
  report: { header: string; footer: string };
  /** shown on reports only when filled in */
  company: BrandCompany;
  /** show this branding on /login?org=<organization id> */
  loginBranding: boolean;
}

export const BRAND_LIMITS = {
  displayName: 40, header: 100, footer: 100, companyName: 120, address: 300, addressLines: 4, website: 200, email: 200, phone: 40,
} as const;

/** Upload limits (bytes). Uploads go through a Server Action, whose request body is capped at 1 MB. */
export const BRAND_FILE_LIMITS = { logo: 1_000_000, favicon: 256 * 1024, svg: 200 * 1024 } as const;
export const BRAND_FILE_TYPES: Record<BrandAssetKind, string[]> = {
  logo: ["png", "jpg", "webp", "svg"], logoLight: ["png", "jpg", "webp", "svg"], logoDark: ["png", "jpg", "webp", "svg"],
  favicon: ["png", "ico", "svg", "webp", "jpg"],
};

/** The current SEO Insights colours (light mode), shown in the colour pickers while a colour is unset. */
export const DEFAULT_BRAND_COLORS: Record<BrandColorKey, string> = { primary: "#E0482E", secondary: "#2F55D4", accent: "#E0482E" };

export const DEFAULT_BRANDING: Branding = Object.freeze({
  displayName: null, logo: null, logoLight: null, logoDark: null, favicon: null,
  colors: { primary: null, secondary: null, accent: null },
  report: { header: "", footer: "" },
  company: { name: "", address: "", website: "", email: "", phone: "" },
  loginBranding: false,
}) as Branding;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSET_FILE = /^(logo|logoLight|logoDark|favicon)-[a-z0-9]{1,16}-[a-f0-9]{8}\.(png|jpg|webp|svg|ico)$/;

/* ------------------------------------------------------------------------------------------------ assets */

function storageBase(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
}

/** Public URL of an uploaded file (built from the path, so a stored value can never point anywhere else). */
export function assetUrl(path: string): string {
  return `${storageBase()}/storage/v1/object/public/${BRAND_BUCKET}/${path}`;
}

/** The path is a branding file of this organization for this slot. */
export function isAssetPath(path: unknown, orgId: string, kind?: BrandAssetKind): path is string {
  if (typeof path !== "string" || !UUID_RE.test(orgId)) return false;
  const [folder, file, ...rest] = path.split("/");
  if (folder !== orgId || !file || rest.length) return false;
  const m = ASSET_FILE.exec(file);
  return Boolean(m && (!kind || m[1] === kind));
}

const dim = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 20000 ? Math.round(v) : null);

function parseAsset(raw: unknown, orgId: string, kind: BrandAssetKind): BrandAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isAssetPath(r.path, orgId, kind)) return null;
  return { path: r.path, url: assetUrl(r.path), w: dim(r.w), h: dim(r.h) };
}

/* ------------------------------------------------------------------------------------------------- text */

// control, zero-width and bidirectional-override characters: never displayed, and they can disguise text
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

export function oneLine(v: unknown): string {
  return typeof v === "string" ? v.replace(INVISIBLE, "").replace(/\s+/g, " ").trim() : "";
}

function multiLine(v: unknown, maxLines: number): string {
  if (typeof v !== "string") return "";
  return v.split(/\r\n|\r|\n/).map(oneLine).filter(Boolean).slice(0, maxLines).join("\n");
}

/** "#1a73e8", "1A73E8" → "#1A73E8"; empty → null; anything else → undefined (invalid). Only #RRGGBB is accepted. */
export function normalizeHex(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  return m ? `#${m[1].toUpperCase()}` : undefined;
}

/** "acme.com" → "https://acme.com"; "" → ""; invalid → null. Only http(s), no credentials. */
export function normalizeWebsite(v: string): string | null {
  const s = v.trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
    const out = u.toString();
    return u.pathname === "/" && !u.search && !u.hash ? out.replace(/\/$/, "") : out;
  } catch { return null; }
}

/** "https://www.acme.com/" → "www.acme.com" (for display) */
export const websiteLabel = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[0-9().\-\s/]{3,32}(\s*(ext\.?|x)\s*[0-9]{1,6})?$/i;

/* --------------------------------------------------------------------------------------------- parsing */

/**
 * Lenient read of the stored JSON: anything missing, malformed or pointing outside this organization's folder
 * falls back to the default. Used for every render, so a bad value can never break a page.
 */
export function parseBranding(raw: unknown, orgId: string): Branding {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BRANDING, colors: { ...DEFAULT_BRANDING.colors }, report: { ...DEFAULT_BRANDING.report }, company: { ...DEFAULT_BRANDING.company } };
  const r = raw as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const colors = obj(r.colors), report = obj(r.report), company = obj(r.company);
  const clip = (v: unknown, n: number) => oneLine(v).slice(0, n);
  const name = clip(r.displayName, BRAND_LIMITS.displayName);
  const website = normalizeWebsite(clip(company.website, BRAND_LIMITS.website)) ?? "";
  const email = clip(company.email, BRAND_LIMITS.email);
  const phone = clip(company.phone, BRAND_LIMITS.phone);
  return {
    displayName: name && name !== DEFAULT_BRAND_NAME ? name : null,
    logo: parseAsset(r.logo, orgId, "logo"),
    logoLight: parseAsset(r.logoLight, orgId, "logoLight"),
    logoDark: parseAsset(r.logoDark, orgId, "logoDark"),
    favicon: parseAsset(r.favicon, orgId, "favicon"),
    colors: {
      primary: normalizeHex(colors.primary) ?? null,
      secondary: normalizeHex(colors.secondary) ?? null,
      accent: normalizeHex(colors.accent) ?? null,
    },
    report: { header: clip(report.header, BRAND_LIMITS.header), footer: clip(report.footer, BRAND_LIMITS.footer) },
    company: {
      name: clip(company.name, BRAND_LIMITS.companyName),
      address: multiLine(company.address, BRAND_LIMITS.addressLines).slice(0, BRAND_LIMITS.address),
      website,
      email: EMAIL.test(email) ? email : "",
      phone: PHONE.test(phone) ? phone : "",
    },
    loginBranding: r.loginBranding === true,
  };
}

/** What is written to organizations.branding (public URLs are derived from the paths when read). */
export function toStored(b: Branding) {
  const a = (x: BrandAsset | null) => (x ? { path: x.path, w: x.w, h: x.h } : null);
  return {
    v: 1, displayName: b.displayName, logo: a(b.logo), logoLight: a(b.logoLight), logoDark: a(b.logoDark), favicon: a(b.favicon),
    colors: { ...b.colors }, report: { ...b.report }, company: { ...b.company }, loginBranding: b.loginBranding,
  };
}

export type BrandingErrors = Partial<Record<string, string>>;

/**
 * Strict validation of what someone wants to save (field-level messages). The server always re-validates; the
 * settings form runs the same checks as you type. Text is trimmed and cleaned, never silently cut.
 */
export function validateBranding(input: unknown, orgId: string): { ok: true; value: Branding } | { ok: false; errors: BrandingErrors } {
  const errors: BrandingErrors = {};
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const colorsIn = obj(r.colors), reportIn = obj(r.report), companyIn = obj(r.company);
  const text = (field: string, v: unknown, max: number) => {
    const s = oneLine(v);
    if (s.length > max) errors[field] = `Use ${max} characters or fewer.`;
    return s;
  };

  const name = text("displayName", r.displayName, BRAND_LIMITS.displayName);
  const colors = {} as BrandColors;
  for (const k of BRAND_COLOR_KEYS) {
    const c = normalizeHex(colorsIn[k]);
    if (c === undefined) errors[`colors.${k}`] = "Use a hex colour like #1A73E8.";
    colors[k] = c ?? null;
  }
  const assets = {} as Record<BrandAssetKind, BrandAsset | null>;
  for (const k of BRAND_ASSET_KINDS) {
    const raw = r[k];
    if (raw == null) { assets[k] = null; continue; }
    const a = parseAsset(raw, orgId, k);
    if (!a) errors[k] = "That image isn't one of this organization's uploads. Upload it again.";
    assets[k] = a;
  }
  const header = text("report.header", reportIn.header, BRAND_LIMITS.header);
  const footer = text("report.footer", reportIn.footer, BRAND_LIMITS.footer);

  const companyName = text("company.name", companyIn.name, BRAND_LIMITS.companyName);
  const address = multiLine(companyIn.address, 50);
  if (address.length > BRAND_LIMITS.address) errors["company.address"] = `Use ${BRAND_LIMITS.address} characters or fewer.`;
  else if (address.split("\n").length > BRAND_LIMITS.addressLines) errors["company.address"] = `Use ${BRAND_LIMITS.addressLines} lines or fewer.`;
  const websiteIn = text("company.website", companyIn.website, BRAND_LIMITS.website);
  const website = normalizeWebsite(websiteIn);
  if (website === null) errors["company.website"] = "Enter a web address like acme.com or https://acme.com.";
  const email = text("company.email", companyIn.email, BRAND_LIMITS.email);
  if (email && !EMAIL.test(email)) errors["company.email"] = "Enter an email address like hello@acme.com.";
  const phone = text("company.phone", companyIn.phone, BRAND_LIMITS.phone);
  if (phone && !PHONE.test(phone)) errors["company.phone"] = "Use digits, spaces and + ( ) - . only.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      displayName: name && name !== DEFAULT_BRAND_NAME ? name : null,
      ...assets,
      colors,
      report: { header, footer },
      company: { name: companyName, address, website: website ?? "", email, phone },
      loginBranding: r.loginBranding === true,
    },
  };
}

/** Field names that differ (for the audit log; never values). */
export function changedFields(a: Branding, b: Branding): string[] {
  const out: string[] = [];
  if (a.displayName !== b.displayName) out.push("displayName");
  for (const k of BRAND_ASSET_KINDS) if ((a[k]?.path ?? null) !== (b[k]?.path ?? null)) out.push(k);
  for (const k of BRAND_COLOR_KEYS) if (a.colors[k] !== b.colors[k]) out.push(`colors.${k}`);
  for (const k of ["header", "footer"] as const) if (a.report[k] !== b.report[k]) out.push(`report.${k}`);
  for (const k of Object.keys(a.company) as (keyof BrandCompany)[]) if (a.company[k] !== b.company[k]) out.push(`company.${k}`);
  if (a.loginBranding !== b.loginBranding) out.push("loginBranding");
  return out;
}

export const brandName = (b: Pick<Branding, "displayName">) => b.displayName ?? DEFAULT_BRAND_NAME;
export const hasCompanyInfo = (b: Branding) => Object.values(b.company).some(Boolean);

/** Anything at all differs from the default look. */
export function isCustomBranding(b: Branding): boolean {
  return Boolean(b.displayName || b.logo || b.logoLight || b.logoDark || b.favicon || b.colors.primary || b.colors.secondary
    || b.colors.accent || b.report.header || b.report.footer || hasCompanyInfo(b));
}

/** "Acme Digital Agency" → "AD" */
export function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = words.slice(0, 2).map((w) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ""))[0] ?? "");
  return letters.join("").toUpperCase() || "•";
}

/* ----------------------------------------------------------------------------------------------- logos */

/** Which logo shows on light and on dark backgrounds, and its shape (width / height). */
export interface LogoSet { light: string | null; dark: string | null; ratio: number | null }

export function logoSet(b: Branding): LogoSet | null {
  const light = b.logoLight?.url ?? b.logo?.url ?? null;
  const dark = b.logoDark?.url ?? b.logo?.url ?? null;
  if (!light && !dark) return null;
  const a = [b.logo, b.logoLight, b.logoDark].find((x) => x?.w && x?.h) ?? null;
  return { light, dark, ratio: a?.w && a.h ? a.w / a.h : null };
}

/** A wordmark (wide logo) carries the name itself, so the name isn't repeated next to it. */
export const isWideLogo = (l: LogoSet | null) => Boolean(l?.ratio && l.ratio >= 2.2);

/** What the dashboard frame needs (null = the default SEO Insights mark and name). */
export interface ShellBrand {
  name: string;
  logo: LogoSet | null;
  /** square image for the collapsed sidebar: the favicon, or a square-ish logo */
  mark: string | null;
  monogram: string;
  favicon: string | null;
}

export function shellBrand(b: Branding): ShellBrand | null {
  const logo = logoSet(b);
  if (!b.displayName && !logo && !b.favicon) return null;
  const square = logo?.ratio && logo.ratio <= 1.3 ? logo.light ?? logo.dark : null;
  const name = brandName(b);
  return { name, logo, mark: b.favicon?.url ?? square ?? null, monogram: monogram(name), favicon: b.favicon?.url ?? null };
}

/* ---------------------------------------------------------------------------------- public (sign-in page) */

/** The only fields the public branding route returns: no ids, members or settings. */
export interface PublicBranding {
  custom: boolean;
  name: string;
  logo: LogoSet | null;
  favicon: string | null;
  colors: BrandColors;
  company: { name: string; website: string };
}

export const DEFAULT_PUBLIC_BRANDING: PublicBranding = Object.freeze({
  custom: false, name: DEFAULT_BRAND_NAME, logo: null, favicon: null,
  colors: { primary: null, secondary: null, accent: null }, company: { name: "", website: "" },
}) as PublicBranding;

/** The sign-in page shows an organization's branding only when its owners turned that on. */
export function publicBranding(b: Branding): PublicBranding {
  if (!b.loginBranding || !isCustomBranding(b)) return DEFAULT_PUBLIC_BRANDING;
  return {
    custom: true, name: brandName(b), logo: logoSet(b), favicon: b.favicon?.url ?? null, colors: { ...b.colors },
    company: { name: b.company.name, website: b.company.website },
  };
}

/** Defensive read of the public route's JSON in the browser: only storage URLs of the bucket, hex colours. */
export function readPublicBranding(json: unknown): PublicBranding {
  if (!json || typeof json !== "object") return DEFAULT_PUBLIC_BRANDING;
  const j = json as Record<string, unknown>;
  if (j.custom !== true) return DEFAULT_PUBLIC_BRANDING;
  const prefix = `${storageBase()}/storage/v1/object/public/${BRAND_BUCKET}/`;
  const url = (v: unknown) => (typeof v === "string" && v.startsWith(prefix) && /^[\w./-]+$/.test(v.slice(prefix.length)) ? v : null);
  const logoIn = (j.logo && typeof j.logo === "object" ? j.logo : {}) as Record<string, unknown>;
  const logo: LogoSet = { light: url(logoIn.light), dark: url(logoIn.dark), ratio: typeof logoIn.ratio === "number" && logoIn.ratio > 0 && logoIn.ratio < 100 ? logoIn.ratio : null };
  const colorsIn = (j.colors && typeof j.colors === "object" ? j.colors : {}) as Record<string, unknown>;
  const companyIn = (j.company && typeof j.company === "object" ? j.company : {}) as Record<string, unknown>;
  const name = oneLine(j.name).slice(0, BRAND_LIMITS.displayName) || DEFAULT_BRAND_NAME;
  return {
    custom: true, name,
    logo: logo.light || logo.dark ? logo : null,
    favicon: url(j.favicon),
    colors: { primary: normalizeHex(colorsIn.primary) ?? null, secondary: normalizeHex(colorsIn.secondary) ?? null, accent: normalizeHex(colorsIn.accent) ?? null },
    company: { name: oneLine(companyIn.name).slice(0, BRAND_LIMITS.companyName), website: normalizeWebsite(oneLine(companyIn.website).slice(0, BRAND_LIMITS.website)) ?? "" },
  };
}

/* ------------------------------------------------------------------------------------------- colours */

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)) as RGB;
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** a blended toward b by t (0 = a, 1 = b), in sRGB */
export function mix(a: string, b: string, t: number): string {
  const p = toRgb(a), q = toRgb(b);
  return toHex([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as RGB);
}

/**
 * The colour itself when it already reads well on `bg`; otherwise the closest darker (on light backgrounds) or
 * lighter (on dark ones) shade that reaches `min`. Keeps the hue, changes only as much as needed.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  const toward = luminance(bg) > 0.4 ? "#000000" : "#FFFFFF";
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(color, toward, mid), bg) >= min) hi = mid; else lo = mid;
  }
  return mix(color, toward, hi);
}

/** White or near-black text, whichever reads better on `bg`. */
export const readableOn = (bg: string) => (contrast("#FFFFFF", bg) >= contrast("#17171A", bg) ? "#FFFFFF" : "#17171A");

/** The surfaces the dashboard draws colours on (see globals.css). */
export const THEME_SURFACE = { light: "#FFFFFF", dark: "#17171A" } as const;
/** Minimum contrast on the surface: text-capable colours 4.5:1 (WCAG AA), chart colours 3:1. */
export const COLOR_MIN_CONTRAST: Record<BrandColorKey, number> = { primary: 4.5, secondary: 3, accent: 4.5 };

/** How a colour is actually shown in light and dark mode (it may be darkened or lightened for contrast). */
export function shownColor(key: BrandColorKey, hex: string): { light: string; dark: string } {
  return { light: ensureContrast(hex, THEME_SURFACE.light, COLOR_MIN_CONTRAST[key]), dark: ensureContrast(hex, THEME_SURFACE.dark, COLOR_MIN_CONTRAST[key]) };
}

export type CssVars = Record<`--${string}`, string>;

/**
 * Design-token overrides for an organization's colours, for light and dark mode: only the colours it set.
 *  primary → --accent (+ soft tint and readable text on it), secondary → --series (charts),
 *  accent → --highlight (active menu marker, report headings; falls back to --accent)
 * Text-capable colours reach 4.5:1 on the surface, chart colours 3:1.
 */
export function brandTheme(colors: BrandColors): { light: CssVars; dark: CssVars } | null {
  const { primary, secondary, accent } = colors;
  if (!primary && !secondary && !accent) return null;
  const light: CssVars = {}, dark: CssVars = {};
  const L = THEME_SURFACE.light, D = THEME_SURFACE.dark;
  if (primary) {
    const p = shownColor("primary", primary);
    Object.assign(light, { "--accent": p.light, "--accent-soft": mix(p.light, L, 0.9), "--accent-foreground": readableOn(p.light) });
    Object.assign(dark, { "--accent": p.dark, "--accent-soft": mix(p.dark, D, 0.88), "--accent-foreground": readableOn(p.dark) });
  }
  if (secondary) {
    const s = shownColor("secondary", secondary);
    Object.assign(light, { "--series": s.light, "--series-soft": mix(s.light, L, 0.9) });
    Object.assign(dark, { "--series": s.dark, "--series-soft": mix(s.dark, D, 0.85) });
  }
  if (accent) {
    const a = shownColor("accent", accent);
    light["--highlight"] = a.light;
    dark["--highlight"] = a.dark;
  }
  return { light, dark };
}

const decl = (vars: CssVars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");

/**
 * The stylesheet that applies an organization's colours: light, dark (system setting) and print (always light).
 * `:root:root` outranks the defaults in globals.css wherever this sits in the document. Values are generated hex
 * colours only, so the text is safe to inline.
 */
export function brandCss(colors: BrandColors): string {
  const t = brandTheme(colors);
  if (!t) return "";
  return `:root:root{${decl(t.light)}}@media (prefers-color-scheme: dark){:root:root{${decl(t.dark)}}}@media print{:root:root{${decl(t.light)}}}`;
}

/** A CSS string literal for any text (e.g. @page footers): everything outside a safe set is hex-escaped. */
export function cssString(s: string): string {
  return `"${Array.from(s).map((ch) => (/^[\p{L}\p{N} .,:!?@#&()+'%*·|–—_-]$/u.test(ch) ? ch : `\\${ch.codePointAt(0)!.toString(16)} `)).join("")}"`;
}

/**
 * Colours for the sign-in page (always light, warm off-white page, dark artwork panel). Defaults are the
 * current look; only what the organization set is overridden.
 */
export function loginTheme(colors: BrandColors): CssVars {
  const vars: CssVars = {};
  const page = "#FBF8F4", panel = "#17120E";
  if (colors.primary) {
    const p = ensureContrast(colors.primary, page, 4.5);
    Object.assign(vars, { "--login-button": p, "--login-button-hover": mix(p, "#000000", 0.12), "--login-button-fg": readableOn(p), "--login-ring": p });
  }
  const hi = colors.accent ?? colors.primary;
  if (hi) Object.assign(vars, { "--login-link": ensureContrast(hi, page, 4.5), "--login-highlight": ensureContrast(hi, panel, 4.5), "--login-glow": hi });
  return vars;
}
