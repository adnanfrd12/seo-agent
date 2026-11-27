import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "./credentials";
import {
  assetUrl, BRAND_ASSET_KINDS, BRAND_BUCKET, BRAND_FILE_LIMITS, BRAND_FILE_TYPES, changedFields, DEFAULT_BRANDING, parseBranding,
  publicBranding, toStored, UUID_RE, validateBranding,
  type BrandAsset, type BrandAssetKind, type Branding, type BrandingErrors, type PublicBranding,
} from "./branding-theme";

/**
 * Organization branding (white label), the server half: reading (cached briefly), saving (validated, audited) and
 * uploading logos and favicons to the public "org-assets" bucket under "<organization id>/". Types, defaults,
 * validation and the colour theme are in ./branding-theme (client-safe) and re-exported here.
 *
 * Isolation: every read and write is keyed by one organization id; stored file paths must sit in that
 * organization's own folder (checked on save and again on every read), so one organization's branding can never
 * show for another, and an organization without branding always gets the default look.
 */
export * from "./branding-theme";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<Branding> }>();

/** Drop the cached branding on this server instance (others refresh within 30 seconds). */
export function invalidateBranding(orgId: string) { cache.delete(orgId); }

/** Uncached read (the settings editor). */
export async function readBranding(admin: SupabaseClient, orgId: string): Promise<Branding> {
  if (!UUID_RE.test(orgId)) return DEFAULT_BRANDING;
  const { data, error } = await admin.from("organizations").select("branding").eq("id", orgId).maybeSingle();
  if (error) throw new Error(`Couldn't read this organization's branding (${error.message}).`);
  return parseBranding(data?.branding, orgId);
}

/**
 * An organization's branding for rendering, cached 30 seconds per server instance. Pass the organization the
 * signed-in user is working in (the active client's organization). No id, an unknown organization or a failed
 * read gives the default look: branding never stops a page from rendering.
 */
export function getBranding(orgId: string | null | undefined): Promise<Branding> {
  if (!orgId || !UUID_RE.test(orgId)) return Promise.resolve(DEFAULT_BRANDING);
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value: Promise<Branding> = readBranding(createAdminClient(), orgId).catch((e: unknown) => {
    if (cache.get(orgId)?.value === value) cache.delete(orgId);
    console.error("branding read failed:", e instanceof Error ? e.message : String(e));
    return DEFAULT_BRANDING;
  });
  cache.set(orgId, { at: Date.now(), value });
  if (cache.size > 500) for (const k of [...cache.keys()].slice(0, cache.size - 500)) cache.delete(k);
  return value;
}

/** Only the public fields, and only when the organization turned on sign-in page branding (else the default). */
export async function getPublicBranding(orgId: string): Promise<PublicBranding> {
  return publicBranding(await getBranding(orgId));
}

/* --------------------------------------------------------------------------------------------------- saving */

const assetPaths = (b: Branding) => BRAND_ASSET_KINDS.map((k) => b[k]?.path).filter((p): p is string => Boolean(p));

async function listFiles(admin: SupabaseClient, orgId: string): Promise<{ name: string; created: number }[]> {
  const { data, error } = await admin.storage.from(BRAND_BUCKET).list(orgId, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.id).map((f) => ({ name: f.name, created: Date.parse(f.created_at ?? "") || 0 }));
}

/**
 * Removes this organization's files that the saved branding no longer uses: replaced or removed images, and
 * uploads that were never saved once they're an hour old (a younger one may belong to someone still editing).
 */
export async function pruneBrandAssets(admin: SupabaseClient, orgId: string, keep: string[], graceMs = 60 * 60_000): Promise<number> {
  if (!UUID_RE.test(orgId)) return 0;
  const keepSet = new Set(keep);
  const stale = (await listFiles(admin, orgId))
    .filter((f) => !keepSet.has(`${orgId}/${f.name}`) && Date.now() - f.created > graceMs)
    .map((f) => `${orgId}/${f.name}`);
  if (stale.length) await admin.storage.from(BRAND_BUCKET).remove(stale);
  return stale.length;
}

/** Every branding file of an organization (for when the organization itself is deleted). */
export async function deleteBrandAssets(admin: SupabaseClient, orgId: string): Promise<number> {
  if (!UUID_RE.test(orgId)) return 0;
  const all = (await listFiles(admin, orgId)).map((f) => `${orgId}/${f.name}`);
  if (all.length) await admin.storage.from(BRAND_BUCKET).remove(all);
  return all.length;
}

export type SaveBrandingResult = { ok: true; branding: Branding } | { ok: false; error: string; errors?: BrandingErrors };

/**
 * Validates and stores an organization's branding, writes the audit log (changed field names only) and tidies
 * unused files. Callers must have checked that the user may manage the organization's settings
 * (requireOrg(can.manageSettings, orgId)).
 */
export async function saveBranding(admin: SupabaseClient, orgId: string, actor: string, input: unknown): Promise<SaveBrandingResult> {
  if (!UUID_RE.test(orgId)) return { ok: false, error: "Choose an organization first." };
  const v = validateBranding(input, orgId);
  if (!v.ok) return { ok: false, error: "Check the highlighted fields.", errors: v.errors };
  let before: Branding;
  try { before = await readBranding(admin, orgId); } catch { return { ok: false, error: "Couldn't read the current branding. Try again." }; }

  // images added in this save must be uploads that still exist in this organization's folder
  const added = assetPaths(v.value).filter((p) => !assetPaths(before).includes(p));
  if (added.length) {
    const names = new Set((await listFiles(admin, orgId).catch(() => [])).map((f) => `${orgId}/${f.name}`));
    const missing = added.find((p) => !names.has(p));
    if (missing) {
      const kind = BRAND_ASSET_KINDS.find((k) => v.value[k]?.path === missing)!;
      return { ok: false, error: "An image you chose is no longer available. Upload it again.", errors: { [kind]: "Upload this image again." } };
    }
  }

  const { data, error } = await admin.from("organizations").update({ branding: toStored(v.value) }).eq("id", orgId).select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't save the branding. Try again." };
  invalidateBranding(orgId);
  const changed = changedFields(before, v.value);
  if (changed.length) await audit(admin, orgId, actor, "branding.update", null, { changed });
  await pruneBrandAssets(admin, orgId, assetPaths(v.value)).catch(() => undefined);
  return { ok: true, branding: v.value };
}

/* -------------------------------------------------------------------------------------------------- uploads */

type Ext = "png" | "jpg" | "webp" | "svg" | "ico";
const MIME: Record<Ext, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon" };

/** The file's real type from its first bytes (the name and the browser's MIME type are not trusted). */
export function sniffImage(b: Uint8Array): Ext | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 16 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 22 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1 && buf.readUInt16LE(4) > 0) return "ico";
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "");
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>[]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** Pixel size from the image header, or null when the file isn't a readable image of that type. */
export function imageSize(b: Uint8Array, ext: Ext): { w: number; h: number } | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (ext === "png") return buf.toString("latin1", 12, 16) === "IHDR" ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
    if (ext === "jpg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (ext === "webp") {
      const chunk = buf.toString("latin1", 12, 16);
      if (chunk === "VP8 " && buf.length >= 30) return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L" && buf.length >= 25) { const bits = buf.readUInt32LE(21); return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }; }
      if (chunk === "VP8X" && buf.length >= 30) return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
    if (ext === "ico") {
      const count = buf.readUInt16LE(4);
      if (buf.length < 6 + count * 16) return null;
      let best: { w: number; h: number } | null = null;
      for (let i = 0; i < count; i++) {
        const w = buf[6 + i * 16] || 256, h = buf[7 + i * 16] || 256;
        if (!best || w * h > best.w * best.h) best = { w, h };
      }
      return best;
    }
    // svg: width/height in px (or unitless), else the viewBox
    const tag = /<svg\b[^>]*>/i.exec(buf.toString("utf8"))?.[0] ?? "";
    const len = (name: string) => {
      const m = new RegExp(`\\s${name}\\s*=\\s*["']?\\s*([0-9.]+)\\s*(px)?\\s*["'\\s/>]`, "i").exec(tag);
      return m ? Number(m[1]) : NaN;
    };
    const vb = /\sviewBox\s*=\s*["']\s*[-0-9.e]+[\s,]+[-0-9.e]+[\s,]+([0-9.e]+)[\s,]+([0-9.e]+)\s*["']/i.exec(tag);
    const w = len("width"), h = len("height");
    if (w > 0 && h > 0) return { w: Math.round(w), h: Math.round(h) };
    if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
    return { w: 0, h: 0 }; // a valid SVG without a declared size: scales to its box
  } catch { return null; }
}

const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;
const safeRef = (v: string) => v.startsWith("#") || RASTER_DATA.test(v);

/**
 * Why an SVG isn't accepted, or null. Logos must be plain drawings: no scripts or event handlers, no links,
 * embedded documents, entity declarations or references to anything outside the file (only "#id" and embedded
 * PNG/JPG/GIF/WebP images). Unsafe files are rejected, never "fixed".
 */
export function svgProblem(svg: string): string | null {
  const decoded = svg
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h: string) => { const n = parseInt(h, 16); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "; })
    .replace(/&#([0-9]{1,7});?/g, (_, d: string) => { const n = Number(d); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "; });
  const flat = decoded.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  if (/<!entity|<!doctype[^>]*\[/i.test(decoded)) return "This SVG declares entities. Export it again as a plain SVG, or upload a PNG.";
  // element names may carry a namespace prefix (<svg:script>)
  if (/<\s*([\w.-]+:)?(script|foreignobject|iframe|embed|object|handler|listener|a|audio|video|set)[\s/>]/i.test(decoded)) return "This SVG contains scripts, links or embedded content. Export it again as a plain SVG, or upload a PNG.";
  if (/[\s:]on[a-z]+\s*=/i.test(decoded)) return "This SVG contains event handlers (scripts). Export it again as a plain SVG, or upload a PNG.";
  if (/javascript:|vbscript:|data:text|@import/.test(flat)) return "This SVG contains scripts or imports. Export it again as a plain SVG, or upload a PNG.";
  if (/<\s*([\w.-]+:)?animate[^>]*attributename\s*=\s*["']?\s*([\w.-]+:)?href/i.test(decoded)) return "This SVG animates links. Export it again as a plain SVG, or upload a PNG.";
  for (const m of decoded.matchAll(/[\s:]href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (!safeRef((m[1] ?? m[2] ?? m[3] ?? "").trim())) return "This SVG loads files from elsewhere. Embed them, or upload a PNG.";
  }
  for (const m of decoded.matchAll(/url\(\s*(['"]?)([^)]*?)\1\s*\)/gi)) {
    if (!safeRef(m[2].trim())) return "This SVG loads files from elsewhere. Embed them, or upload a PNG.";
  }
  return null;
}

const KB = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(0)} MB` : `${Math.round(n / 1024)} KB`);
const TYPE_LABEL: Record<Ext, string> = { png: "PNG", jpg: "JPG", webp: "WebP", svg: "SVG", ico: "ICO" };

export type UploadResult = { ok: true; asset: BrandAsset } | { ok: false; error: string };

/**
 * Checks and stores one branding image (server side, service role) at org-assets/<orgId>/<kind>-<stamp>-<random>.<ext>.
 * The type comes from the file's bytes; SVGs must pass svgProblem(); raster images must have a readable size.
 * The returned asset isn't used anywhere until the branding is saved. Callers must have checked the user's role.
 */
export async function uploadBrandAsset(admin: SupabaseClient, orgId: string, kind: BrandAssetKind, file: Blob): Promise<UploadResult> {
  if (!UUID_RE.test(orgId)) return { ok: false, error: "Choose an organization first." };
  if (!BRAND_ASSET_KINDS.includes(kind)) return { ok: false, error: "Unknown image slot." };
  const allowed = BRAND_FILE_TYPES[kind];
  const names = allowed.map((e) => TYPE_LABEL[e as Ext]);
  const allowedText = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  const limit = kind === "favicon" ? BRAND_FILE_LIMITS.favicon : BRAND_FILE_LIMITS.logo;
  if (!file || file.size === 0) return { ok: false, error: "Choose an image file." };
  if (file.size > limit) return { ok: false, error: `That file is over ${KB(limit)}. Choose a smaller one.` };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext || !allowed.includes(ext)) return { ok: false, error: `Choose a ${allowedText} image.` };

  if (ext === "svg") {
    if (bytes.byteLength > BRAND_FILE_LIMITS.svg) return { ok: false, error: `SVG files can be up to ${KB(BRAND_FILE_LIMITS.svg)}.` };
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return { ok: false, error: "That SVG isn't valid text. Export it again, or upload a PNG." }; }
    const problem = svgProblem(text);
    if (problem) return { ok: false, error: problem };
  }

  const size = imageSize(bytes, ext);
  if (!size) return { ok: false, error: `That file couldn't be read as a ${TYPE_LABEL[ext]} image.` };
  if (ext !== "svg" && (size.w < 16 || size.h < 16)) return { ok: false, error: "That image is too small. Use one at least 16 pixels wide and high." };
  if (size.w > 6000 || size.h > 6000) return { ok: false, error: "That image is too large. Use one up to 6000 pixels wide and high." };
  if (kind === "favicon" && size.w && size.h && (size.w / size.h > 1.34 || size.h / size.w > 1.34)) {
    return { ok: false, error: "The favicon should be square, for example 512 × 512 pixels." };
  }

  const path = `${orgId}/${kind}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${ext}`;
  const { error } = await admin.storage.from(BRAND_BUCKET).upload(path, bytes, { contentType: MIME[ext], upsert: false, cacheControl: "31536000" });
  if (error) return { ok: false, error: "The upload failed. Try again." };
  return { ok: true, asset: { path, url: assetUrl(path), w: size.w || null, h: size.h || null } };
}
