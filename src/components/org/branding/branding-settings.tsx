"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Check, Copy, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import {
  BRAND_FILE_LIMITS, BRAND_LIMITS, DEFAULT_BRAND_COLORS, DEFAULT_BRAND_NAME, normalizeHex, parseBranding, shownColor, validateBranding,
  type BrandAsset, type BrandAssetKind, type BrandColorKey, type BrandCompany, type Branding, type BrandingErrors,
} from "@/lib/org/branding-theme";
import { Section } from "@/components/org/section";
import { btn, input as inputCls } from "@/components/org/styles";
import { useUnsavedWarning } from "@/components/org/ui";
import { cn } from "@/lib/utils";
import { loadBrandingSettings, saveBrandingSettings, uploadBrandingAsset, type BrandingSettingsData } from "./actions";
import { BrandingPreview } from "./branding-preview";

const secondaryBtn = btn.secondary;

/* -------------------------------------------------------------------------------------------- draft */

/** What the form edits: plain strings ("" = default) and uploaded images. */
interface Draft {
  displayName: string;
  logo: BrandAsset | null; logoLight: BrandAsset | null; logoDark: BrandAsset | null; favicon: BrandAsset | null;
  colors: Record<BrandColorKey, string>;
  header: string; footer: string;
  company: BrandCompany;
  loginBranding: boolean;
}

const toDraft = (b: Branding): Draft => ({
  displayName: b.displayName ?? "", logo: b.logo, logoLight: b.logoLight, logoDark: b.logoDark, favicon: b.favicon,
  colors: { primary: b.colors.primary ?? "", secondary: b.colors.secondary ?? "", accent: b.colors.accent ?? "" },
  header: b.report.header, footer: b.report.footer, company: { ...b.company }, loginBranding: b.loginBranding,
});
const ref = (a: BrandAsset | null) => (a ? { path: a.path, w: a.w, h: a.h } : null);
/** The shape the server validates (and stores). */
const toInput = (d: Draft) => ({
  displayName: d.displayName, logo: ref(d.logo), logoLight: ref(d.logoLight), logoDark: ref(d.logoDark), favicon: ref(d.favicon),
  colors: d.colors, report: { header: d.header, footer: d.footer }, company: d.company, loginBranding: d.loginBranding,
});

/* ----------------------------------------------------------------------------------------- component */

/**
 * Settings → Organization → Branding: logos, favicon, colours, platform name, report header/footer and company
 * details, and sign-in page branding, with a live preview. Loads its own data (any member may view); owners and
 * admins can save. `initial` (from loadBrandingSettings on the server) skips the loading state.
 */
export function BrandingSettings({ orgId, canEdit, initial }: { orgId: string; canEdit: boolean; initial?: BrandingSettingsData }) {
  const [state, setState] = useState<{ orgId: string; data?: BrandingSettingsData; error?: string } | null>(initial ? { orgId, data: initial } : null);
  const current = state?.orgId === orgId ? state : null;

  useEffect(() => {
    if (current) return;
    let live = true;
    loadBrandingSettings(orgId).then(
      (r) => { if (live) setState(r.ok ? { orgId, data: r.data } : { orgId, error: r.error }); },
      () => { if (live) setState({ orgId, error: "Couldn't load the branding. Reload the page to try again." }); },
    );
    return () => { live = false; };
  }, [orgId, current]);

  if (!current) {
    return (
      <div className="@container" aria-busy="true" aria-label="Loading branding">
        <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-[10px]" />)}</div>
          <div className="skeleton hidden h-80 rounded-[10px] @4xl:block" />
        </div>
      </div>
    );
  }
  if (!current.data) return <p role="alert" className="rounded-[10px] border border-border bg-surface p-5 text-sm text-negative">{current.error}</p>;
  return <BrandingEditor key={orgId} orgId={orgId} canEdit={canEdit && current.data.canEdit} data={current.data} />;
}

function BrandingEditor({ orgId, canEdit, data }: { orgId: string; canEdit: boolean; data: BrandingSettingsData }) {
  const [saved, setSaved] = useState(data.branding);
  const [draft, setDraft] = useState(() => toDraft(data.branding));
  const [touched, setTouched] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<BrandingErrors>({});
  const [assetErrors, setAssetErrors] = useState<Partial<Record<BrandAssetKind, string>>>({});
  const [uploading, setUploading] = useState<BrandAssetKind | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const input = toInput(draft);
  const dirty = JSON.stringify(input) !== JSON.stringify(toInput(toDraft(saved)));
  const check = validateBranding(input, orgId);
  const live: BrandingErrors = check.ok ? {} : check.errors;
  const errorFor = (k: string) => serverErrors[k] ?? (attempted || touched.includes(k) ? live[k] : undefined);
  const blur = (k: string) => () => setTouched((t) => (t.includes(k) ? t : [...t, k]));
  // what the preview shows: the draft, read the way every page reads stored branding
  const preview = parseBranding(input, orgId);

  useUnsavedWarning(dirty && canEdit);

  function update(patch: Partial<Draft>, field?: string) {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
    if (field && serverErrors[field]) setServerErrors((e) => { const next = { ...e }; delete next[field]; return next; });
  }
  const setColor = (k: BrandColorKey, v: string) => update({ colors: { ...draft.colors, [k]: v } }, `colors.${k}`);
  const setCompany = (k: keyof BrandCompany, v: string) => update({ company: { ...draft.company, [k]: v } }, `company.${k}`);

  async function pick(kind: BrandAssetKind, file: File) {
    setAssetErrors((e) => ({ ...e, [kind]: undefined }));
    const limit = kind === "favicon" ? BRAND_FILE_LIMITS.favicon : BRAND_FILE_LIMITS.logo;
    if (file.size > limit) return setAssetErrors((e) => ({ ...e, [kind]: `That file is over ${kind === "favicon" ? "256 KB" : "1 MB"}. Choose a smaller one.` }));
    setUploading(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await uploadBrandingAsset(orgId, kind, form);
      if (r.ok) update({ [kind]: r.asset }, kind);
      else setAssetErrors((e) => ({ ...e, [kind]: r.error }));
    } catch {
      setAssetErrors((e) => ({ ...e, [kind]: "The upload failed. Check your connection and try again." }));
    } finally {
      setUploading(null);
    }
  }

  function save() {
    setAttempted(true);
    if (!check.ok) return setStatus({ ok: false, text: "Check the highlighted fields." });
    start(async () => {
      const r = await saveBrandingSettings(orgId, input).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection and try again.", errors: undefined }));
      if (!r.ok) {
        setServerErrors(r.errors ?? {});
        setStatus({ ok: false, text: r.error });
        return;
      }
      setSaved(r.branding);
      setDraft(toDraft(r.branding));
      setServerErrors({});
      setAssetErrors({});
      setAttempted(false);
      setTouched([]);
      setStatus({ ok: true, text: "Branding saved. It shows for everyone in this organization." });
    });
  }

  function discard() {
    setDraft(toDraft(saved));
    setServerErrors({});
    setAssetErrors({});
    setAttempted(false);
    setTouched([]);
    setStatus(null);
  }

  const p = data.profile;
  const hasProfile = Object.values(p).some(Boolean);
  const disabled = !canEdit || pending;

  return (
    <div className="@container space-y-6">
      {!canEdit && (
        <p className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-muted">Only organization owners and admins can change branding.</p>
      )}
      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-last min-w-0 space-y-6 @4xl:order-first">
          <Section className="@container" title="Name and logos" description="Shown to everyone working in this organization's clients, on its reports and, if you turn it on, on its sign-in page.">
            <TextField id="brand-name" label="Platform name" hint={`Replaces “${DEFAULT_BRAND_NAME}”. Leave empty to keep it.`} value={draft.displayName}
              placeholder={DEFAULT_BRAND_NAME} max={BRAND_LIMITS.displayName} error={errorFor("displayName")} disabled={disabled}
              onChange={(v) => update({ displayName: v }, "displayName")} onBlur={blur("displayName")} />
            <div className="mt-5 grid gap-x-6 gap-y-5 @xl:grid-cols-2">
              <AssetField kind="logo" label="Logo" hint="Used everywhere unless you add the versions below. PNG, JPG, WebP or SVG, up to 1 MB."
                asset={draft.logo} busy={uploading === "logo"} error={assetErrors.logo ?? errorFor("logo")} disabled={disabled}
                onPick={(f) => pick("logo", f)} onRemove={() => update({ logo: null }, "logo")} />
              <AssetField kind="favicon" label="Favicon" hint="The browser tab icon. Square, 32 × 32 or larger. PNG, ICO or SVG, up to 256 KB."
                asset={draft.favicon} busy={uploading === "favicon"} error={assetErrors.favicon ?? errorFor("favicon")} disabled={disabled}
                onPick={(f) => pick("favicon", f)} onRemove={() => update({ favicon: null }, "favicon")} />
              <AssetField kind="logoLight" label="Logo for light mode" hint="Dark artwork for light backgrounds: light mode, reports and the sign-in page."
                asset={draft.logoLight} busy={uploading === "logoLight"} error={assetErrors.logoLight ?? errorFor("logoLight")} disabled={disabled}
                onPick={(f) => pick("logoLight", f)} onRemove={() => update({ logoLight: null }, "logoLight")} />
              <AssetField kind="logoDark" label="Logo for dark mode" hint="Light artwork for dark backgrounds." dark
                asset={draft.logoDark} busy={uploading === "logoDark"} error={assetErrors.logoDark ?? errorFor("logoDark")} disabled={disabled}
                onPick={(f) => pick("logoDark", f)} onRemove={() => update({ logoDark: null }, "logoDark")} />
            </div>
          </Section>

          <Section className="@container" title="Colours" description="Leave a colour empty to keep the default. If a colour would be hard to read on a light or dark background, a darker or lighter shade of it is used there. Each colour shows what you get.">
            <div className="grid gap-x-6 gap-y-5 @2xl:grid-cols-3">
              <ColorField k="primary" label="Primary" hint="Buttons, links and selected items." value={draft.colors.primary} error={errorFor("colors.primary")}
                disabled={disabled} onChange={(v) => setColor("primary", v)} onBlur={blur("colors.primary")} />
              <ColorField k="secondary" label="Secondary" hint="Charts (this period)." value={draft.colors.secondary} error={errorFor("colors.secondary")}
                disabled={disabled} onChange={(v) => setColor("secondary", v)} onBlur={blur("colors.secondary")} />
              <ColorField k="accent" label="Accent" hint="Highlights: the active menu item, report headings." value={draft.colors.accent} error={errorFor("colors.accent")}
                disabled={disabled} onChange={(v) => setColor("accent", v)} onBlur={blur("colors.accent")} />
            </div>
          </Section>

          <Section className="@container" title="Reports" description="On report covers, in the margins of every page and in PDF downloads.">
            <div className="grid gap-x-6 gap-y-4 @md:grid-cols-2">
              <TextField id="brand-header" label="Header text" hint="Top of the cover and of every page, e.g. “Confidential”." value={draft.header}
                max={BRAND_LIMITS.header} error={errorFor("report.header")} disabled={disabled}
                onChange={(v) => update({ header: v }, "report.header")} onBlur={blur("report.header")} />
              <TextField id="brand-footer" label="Footer text" hint="Bottom of every page, next to the page number." value={draft.footer}
                max={BRAND_LIMITS.footer} error={errorFor("report.footer")} disabled={disabled}
                onChange={(v) => update({ footer: v }, "report.footer")} onBlur={blur("report.footer")} />
            </div>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Company details</p>
                <p className="text-xs text-muted">Shown on report covers as “Prepared by”. Leave empty to show none.</p>
              </div>
              {hasProfile && canEdit && (
                <button type="button" disabled={disabled} className={secondaryBtn}
                  onClick={() => update({ company: { name: p.name || draft.company.name, address: p.address || draft.company.address, website: p.website || draft.company.website, email: p.email || draft.company.email, phone: p.phone || draft.company.phone } })}>
                  Use organization details
                </button>
              )}
            </div>
            <div className="mt-3 grid gap-x-6 gap-y-4 @md:grid-cols-2">
              <TextField id="brand-company" label="Company name" value={draft.company.name} max={BRAND_LIMITS.companyName} error={errorFor("company.name")}
                disabled={disabled} onChange={(v) => setCompany("name", v)} onBlur={blur("company.name")} autoComplete="organization" />
              <TextField id="brand-website" label="Website" value={draft.company.website} max={BRAND_LIMITS.website} error={errorFor("company.website")}
                disabled={disabled} onChange={(v) => setCompany("website", v)} onBlur={blur("company.website")} placeholder="acme.com" inputMode="url" />
              <TextField id="brand-email" label="Email" value={draft.company.email} max={BRAND_LIMITS.email} error={errorFor("company.email")}
                disabled={disabled} onChange={(v) => setCompany("email", v)} onBlur={blur("company.email")} inputMode="email" />
              <TextField id="brand-phone" label="Phone" value={draft.company.phone} max={BRAND_LIMITS.phone} error={errorFor("company.phone")}
                disabled={disabled} onChange={(v) => setCompany("phone", v)} onBlur={blur("company.phone")} inputMode="tel" />
              <TextField id="brand-address" label="Address" value={draft.company.address} max={BRAND_LIMITS.address} error={errorFor("company.address")}
                disabled={disabled} onChange={(v) => setCompany("address", v)} onBlur={blur("company.address")} multiline className="@md:col-span-2" hint="Up to 4 lines." />
            </div>
          </Section>

          <Section className="@container" title="Sign-in page">
            <LoginBranding orgId={orgId} on={draft.loginBranding} savedOn={saved.loginBranding} disabled={disabled} onChange={(v) => update({ loginBranding: v })} />
          </Section>
        </div>

        <div className="order-first min-w-0 @4xl:sticky @4xl:top-4 @4xl:order-last">
          <BrandingPreview brand={preview} />
        </div>
      </div>

      {canEdit && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-surface/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] backdrop-blur">
          <p aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 text-warn"><span className="size-1.5 rounded-full bg-warn" aria-hidden /> Unsaved changes</span>
            ) : !status && <span className="text-muted">No unsaved changes</span>}
            {status && <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-positive" : "text-negative"}>{status.text}</span>}
          </p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={discard} disabled={!dirty || pending} className={btn.ghost}>Discard</button>
            <button type="button" onClick={save} disabled={!dirty || pending || uploading !== null} className={btn.primary}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Save branding
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- pieces */

function TextField({ id, label, hint, value, onChange, onBlur, max, error, disabled, placeholder, multiline, className, inputMode, autoComplete }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; onBlur?: () => void; max: number; error?: string;
  disabled?: boolean; placeholder?: string; multiline?: boolean; className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string;
}) {
  const over = value.trim().length > max;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const common = { id, value, disabled, placeholder, onBlur, "aria-invalid": Boolean(error) || over, "aria-describedby": describedBy };
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {value.length > max * 0.7 && <span className={cn("text-[11px] tabular-nums", over ? "text-negative" : "text-faint")}>{value.trim().length}/{max}</span>}
      </div>
      {multiline
        ? <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "resize-y")} />
        : <input {...common} inputMode={inputMode} autoComplete={autoComplete ?? "off"} onChange={(e) => onChange(e.target.value)} className={inputCls} />}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-negative">{error}</p>}
    </div>
  );
}

const ACCEPT: Record<"logo" | "favicon", string> = {
  logo: ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml",
  favicon: ".png,.ico,.svg,.webp,.jpg,.jpeg,image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/webp,image/jpeg",
};

function AssetField({ kind, label, hint, asset, busy, error, disabled, dark, onPick, onRemove }: {
  kind: BrandAssetKind; label: string; hint: string; asset: BrandAsset | null; busy: boolean; error?: string; disabled: boolean; dark?: boolean;
  onPick: (f: File) => void; onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const icon = kind === "favicon";
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium" id={`brand-${kind}-label`}>{label}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <div className="mt-2.5 flex items-center gap-3">
        <div className={cn("grid h-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border", icon ? "w-16" : "w-32", dark ? "bg-[#17171A]" : "bg-white")}>
          {busy ? <Loader2 className={cn("size-5 animate-spin", dark ? "text-white/70" : "text-faint")} aria-hidden />
            : asset ? (
              // eslint-disable-next-line @next/next/no-img-element -- just-uploaded file in the public org-assets bucket
              <img src={asset.url} alt={`${label} preview`} className={cn("object-contain", icon ? "size-8" : "max-h-11 max-w-[104px]")} />
            ) : <ImageIcon className={cn("size-5", dark ? "text-white/40" : "text-faint")} aria-hidden />}
        </div>
        {!disabled || busy ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled || busy} aria-describedby={`brand-${kind}-label`} className={secondaryBtn}>
              <Upload className="size-4" aria-hidden /> {asset ? "Replace" : "Upload"}
            </button>
            {asset && (
              <button type="button" onClick={onRemove} disabled={disabled || busy} aria-label={`Remove ${label.toLowerCase()}`} className={btn.danger}>
                <Trash2 className="size-4" aria-hidden /> Remove
              </button>
            )}
          </div>
        ) : !asset && <span className="text-xs text-faint">Not set</span>}
        <input ref={fileRef} type="file" hidden accept={ACCEPT[icon ? "favicon" : "logo"]}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-negative">{error}</p>}
      {!error && asset?.w && asset.h ? <p className="mt-1 text-[11px] tabular-nums text-faint">{asset.w} × {asset.h} px</p> : null}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="inline-flex items-center gap-1 font-mono text-[11px]"><span className="size-3 rounded-sm border border-border" style={{ background: color }} aria-hidden />{color}</span>;
}

function ColorField({ k, label, hint, value, error, disabled, onChange, onBlur }: {
  k: BrandColorKey; label: string; hint: string; value: string; error?: string; disabled: boolean; onChange: (v: string) => void; onBlur: () => void;
}) {
  const hex = normalizeHex(value);
  const shown = hex ? shownColor(k, hex) : null;
  const id = `brand-color-${k}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <input type="color" value={(hex ?? DEFAULT_BRAND_COLORS[k]).toLowerCase()} disabled={disabled} aria-label={`Pick the ${label.toLowerCase()} colour`}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-60" />
        <input id={id} value={value} disabled={disabled} placeholder={DEFAULT_BRAND_COLORS[k]} maxLength={7} spellCheck={false} autoComplete="off"
          aria-invalid={Boolean(error)} aria-describedby={`${id}-note`} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
          className={cn(inputCls, "mt-0 w-[6.75rem] font-mono uppercase")} />
        {value && !disabled && (
          <button type="button" onClick={() => onChange("")} className="rounded text-xs font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">Default</button>
        )}
      </div>
      <div id={`${id}-note`} className="mt-1.5 text-xs">
        {error ? <p role="alert" className="text-negative">{error}</p>
          : !hex || !shown ? <p className="text-faint">Default colour</p>
          : <ContrastNote k={k} hex={hex} shown={shown} />}
      </div>
    </div>
  );
}

/**
 * Says plainly when a colour is shown as a different shade, in which mode, and why. Colours that already read well
 * on both backgrounds are used exactly as chosen.
 */
function ContrastNote({ k, hex, shown }: { k: BrandColorKey; hex: string; shown: { light: string; dark: string } }) {
  const why = k === "secondary" ? "so charts stay visible" : "so text stays readable";
  const light = shown.light !== hex, dark = shown.dark !== hex;
  if (!light && !dark) return <p className="text-faint">Used as chosen in light and dark mode.</p>;
  const row = (mode: string, adjusted: boolean, c: string, shade: string) => (
    <li className="flex flex-wrap items-center gap-x-1.5">
      <span className="w-[4.5rem] shrink-0">{mode}</span>
      {adjusted ? <><Swatch color={c} /><span>{shade}</span></> : <><Swatch color={hex} /><span className="text-faint">as chosen</span></>}
    </li>
  );
  return (
    <div className="text-muted">
      <p>{light && dark ? `Shown in adjusted shades ${why}:` : `Shown ${light ? "darker in light" : "lighter in dark"} mode ${why}:`}</p>
      <ul className="mt-1 space-y-0.5">
        {row("Light mode", light, shown.light, "darker")}
        {row("Dark mode", dark, shown.dark, "lighter")}
      </ul>
    </div>
  );
}

const noopSubscribe = () => () => {};

function LoginBranding({ orgId, on, savedOn, disabled, onChange }: { orgId: string; on: boolean; savedOn: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const link = `${origin}/login?org=${orgId}`;
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => undefined);
  }
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="brand-login-label" className="text-sm font-medium">Show this branding on the sign-in page</p>
          <p id="brand-login-hint" className="mt-0.5 text-xs text-muted">People who open your sign-in link see your logo, name and colours instead of {DEFAULT_BRAND_NAME}.</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="brand-login-label" aria-describedby="brand-login-hint" disabled={disabled}
          onClick={() => onChange(!on)}
          className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60",
            on ? "bg-accent" : "bg-border-strong")}>
          <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
        </button>
      </div>
      {on && (
        <div className="mt-4">
          <label htmlFor="brand-login-link" className="text-xs font-medium text-muted">Your sign-in link</label>
          <div className="mt-1 flex gap-2">
            <input id="brand-login-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={cn(inputCls, "mt-0 min-w-0 font-mono text-xs")} />
            <button type="button" onClick={copy} className={cn(secondaryBtn, "shrink-0")}>
              {copied ? <Check className="size-4 text-positive" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {savedOn ? "Share it with the people you invite. Signing out also returns them here." : "Save to switch the link on."}
          </p>
        </div>
      )}
    </div>
  );
}
