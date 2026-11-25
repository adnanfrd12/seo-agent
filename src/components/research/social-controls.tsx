"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, CircleCheck, Clock, Copy, ExternalLink, Info, Link2, Loader2, Plug, RefreshCw, Search, Settings2, Unplug, UserRound, X } from "lucide-react";
import { detectSocialProfiles, disconnectSocial, refreshSocialNow, saveSocialSettings, socialConnectLink } from "@/app/(dashboard)/social/actions";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "@/lib/social/platforms";
import { platformBySocial } from "@/config/platforms";
import { ConsentPanel } from "@/components/integrations/consent-panel";
import { PlatformTile } from "@/components/brand/social-logos";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, dialogBtn } from "@/components/dashboard/dialog";
import { cn } from "@/lib/utils";

type Msg = { ok: boolean; text: string } | null;
const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60";

/** Owner buttons: refresh every platform now, and find profile links on the website (free). */
export function SocialRefresh({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  if (!canEdit) return null;
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    router.refresh();
  });
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <button className={`${btn} bg-accent text-accent-foreground hover:opacity-90`} disabled={pending} onClick={() => run(refreshSocialNow)}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh stats <span className="opacity-70">(≤ $0.07)</span>
        </button>
        <button className={`${btn} border border-border bg-surface hover:bg-surface-muted`} disabled={pending} onClick={() => run(detectSocialProfiles)}>
          <Search className="size-4" /> Find profiles on website <span className="opacity-70">(free)</span>
        </button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`max-w-md break-words text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}

/** Owner form: profile URLs plus optional per-client tokens (stored encrypted, never shown again). */
export function SocialSettings({ profiles, tokens, linkedinOrgId }: { profiles: Partial<Record<Platform, string>>; tokens: Record<Platform, "client" | "env" | null>; linkedinOrgId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [urls, setUrls] = useState<Partial<Record<Platform, string>>>(profiles);
  const [secrets, setSecrets] = useState<Partial<Record<Platform, string>>>({});
  const [org, setOrg] = useState(linkedinOrgId ?? "");
  const input = "w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm";
  return (
    <div className="rounded-[10px] border border-border bg-surface">
      <button className="flex w-full items-center gap-2 p-4 text-left text-sm font-semibold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Settings2 className="size-4" /> Profiles and API access <span className="font-normal text-muted">{open ? "(hide)" : "(edit)"}</span>
      </button>
      {open && (
        <form className="space-y-3 border-t border-hairline p-4" onSubmit={(e) => { e.preventDefault(); start(async () => {
          setMsg(null);
          const r = await saveSocialSettings({ profiles: urls, tokens: secrets, linkedinOrgId: org });
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          if (r.ok) { setSecrets({}); router.refresh(); }
        }); }}>
          {PLATFORMS.map((p) => (
            <div key={p} className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
              <label htmlFor={`url-${p}`} className="text-sm font-medium">{PLATFORM_INFO[p].label}</label>
              <input id={`url-${p}`} className={input} placeholder="Profile URL" value={urls[p] ?? ""} onChange={(e) => setUrls({ ...urls, [p]: e.target.value })} />
              <input aria-label={`${PLATFORM_INFO[p].label} token`} type="password" autoComplete="off" className={input}
                placeholder={tokens[p] === "client" ? "Token saved (type - to remove)" : tokens[p] === "env" ? `Using ${PLATFORM_INFO[p].env}` : PLATFORM_INFO[p].tokenLabel}
                value={secrets[p] ?? ""} onChange={(e) => setSecrets({ ...secrets, [p]: e.target.value })} />
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
            <label htmlFor="li-org" className="text-sm font-medium">LinkedIn org id</label>
            <input id="li-org" className={input} placeholder="Optional: numeric id from the page admin URL (linkedin.com/company/12345/admin)" value={org} onChange={(e) => setOrg(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className={`${btn} bg-accent text-accent-foreground hover:opacity-90`} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save</button>
            <p className="text-xs text-muted">Tokens are stored encrypted. Leave a field empty to keep the saved token.</p>
          </div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}

export interface ConnectRow {
  platform: Platform; state: "connected" | "pending" | "none"; ready: boolean; note: string | null; lastSync?: string | null;
  /** when an unfinished login was started */
  since?: string | null;
  /** who is logged in, from the last read (null until the first read finishes) */
  account?: { handle: string | null; name: string | null; avatar: string | null; url: string | null } | null;
}

/** What a connected account adds, in a few words (only what is actually read). */
const BLURB: Record<Platform, string> = {
  youtube: "Subscribers, views, watch time and videos",
  facebook: "Page followers, views and engagement",
  instagram: "Followers, reach, engagement and audience",
  tiktok: "Followers, likes and video views",
  x: "Followers and post impressions",
  linkedin: "Page followers, impressions and clicks",
  threads: "Followers, views and engagement",
  pinterest: "Impressions, saves and clicks",
};

/** Card buttons. */
const cb = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60";
const cbPrimary = `${cb} bg-accent text-accent-foreground hover:opacity-90`;
const cbSecondary = `${cb} border border-border bg-surface text-foreground hover:bg-surface-muted`;
const cbDanger = `${cb} px-2.5 text-negative hover:bg-negative-soft`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
/** "5 minutes ago", "yesterday". */
function ago(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (!Number.isFinite(s)) return "";
  const a = Math.abs(s);
  if (a < 60) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86_400), "day");
}
function When({ iso }: { iso: string }) {
  return <time dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>{ago(iso)}</time>;
}

const dangerIcon = <span className="grid size-10 shrink-0 place-items-center rounded-full bg-negative-soft text-negative"><Unplug className="size-5" aria-hidden /></span>;

/** One card per platform: the owner logs in on the platform's own page through Composio (official OAuth). */
export function SocialConnect({ rows, canEdit }: { rows: ConnectRow[]; canEdit: boolean }) {
  const router = useRouter();
  const flow = useConnectFlow();
  const [msg, setMsg] = useState<Msg>(null);
  const [removing, setRemoving] = useState<Platform | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [removePending, startRemove] = useTransition();
  if (!canEdit) return null;

  const target = rows.find((r) => r.platform === removing) ?? null;
  const tLabel = target ? PLATFORM_INFO[target.platform].label : "";
  const tHandle = target?.account?.handle?.replace(/^@/, "");
  const who = tHandle ? `@${tHandle}` : target?.account?.name ?? `this ${tLabel} account`;
  const remove = () => {
    if (!target) return;
    const { platform: p, state } = target;
    setRemoveErr(null);
    startRemove(async () => {
      const r = await disconnectSocial(p);
      if (!r.ok) { setRemoveErr(r.error); return; }
      setRemoving(null);
      setMsg({ ok: true, text: state === "pending" ? `The unfinished ${PLATFORM_INFO[p].label} login was cancelled.` : `${PLATFORM_INFO[p].label} disconnected. Its access and the stats read from it were deleted.` });
      router.refresh();
    });
  };
  const connected = rows.filter((r) => r.state === "connected").length;
  const notes = rows.filter((r) => !r.ready && r.note).map((r) => r.note).join(" ");

  return (
    <section aria-labelledby="connect-social-title" className="rounded-[12px] border border-border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 id="connect-social-title" className="flex items-center gap-2 text-[15px] font-semibold"><Plug className="size-4" aria-hidden /> Connect social accounts</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">Connected accounts give full analytics; others show public numbers only.</p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface-sunken px-2.5 py-1 text-xs font-medium text-secondary">
          <span className="tabular-nums text-foreground">{connected}</span> of {rows.length} connected
        </span>
      </header>

      {msg && (
        <div role={msg.ok ? "status" : "alert"} className={cn("mx-4 mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] sm:mx-5", msg.ok ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative")}>
          {msg.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">{msg.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setMsg(null)} className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent"><X className="size-3.5" /></button>
        </div>
      )}

      <ul className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        {rows.map((r) => (
          <ConnectCard key={r.platform} r={r} onConnect={(mode) => flow.open(r.platform, mode)} onRemove={() => { setRemoveErr(null); setRemoving(r.platform); }} />
        ))}
      </ul>

      {notes && (
        <p className="flex gap-2 border-t border-hairline px-4 py-3 text-xs leading-relaxed text-muted sm:px-5">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>{notes}</span>
        </p>
      )}

      <ConnectDialog flow={flow} />
      <ConfirmDialog
        open={Boolean(target)} onClose={() => setRemoving(null)} onConfirm={remove} busy={removePending} error={removeErr} icon={dangerIcon}
        title={target?.state === "pending" ? `Cancel the ${tLabel} login?` : `Disconnect ${tLabel}?`}
        confirmLabel={target?.state === "pending" ? "Cancel login" : "Disconnect"} cancelLabel={target?.state === "pending" ? "Keep it" : "Cancel"}
      >
        {target?.state === "pending" ? (
          <p>The unfinished login is removed and its link stops working. Nothing has been read from this account.</p>
        ) : (
          <>
            <p>SEO Insights loses access to <strong className="font-medium text-foreground">{who}</strong>, and the stats read from it are deleted. This can&apos;t be undone.</p>
            <p className="mt-2">You can connect it again at any time; its history then starts over.</p>
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}

/** The Integrations page's "connected" mark: green check and text, no pill. */
export function ConnectedMark({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium text-positive", className)}><CircleCheck className="size-4" aria-hidden /> Connected</span>;
}

function StatusPill({ r }: { r: ConnectRow }) {
  if (r.state === "connected") return <ConnectedMark />;
  const planned = platformBySocial(r.platform)?.status === "planned";
  const [text, tone, dot] =
    r.state === "pending" ? ["Login not finished", "bg-warn-soft text-warn", "bg-warn"]
    : r.ready ? ["Not connected", "bg-surface-muted text-muted", "bg-faint"]
    : planned ? ["Coming soon", "bg-surface-muted text-muted", null]
    : ["Setup needed", "bg-surface-muted text-muted", null];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}{text}
    </span>
  );
}

function ConnectCard({ r, onConnect, onRemove }: { r: ConnectRow; onConnect: (mode: "connect" | "reconnect") => void; onRemove: () => void }) {
  const label = PLATFORM_INFO[r.platform].label;
  const planned = platformBySocial(r.platform)?.status === "planned";
  return (
    <li className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface transition-colors hover:border-border-strong">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-3">
          <PlatformTile platform={r.platform} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold leading-tight">{label}</h3>
            <div className="mt-1"><StatusPill r={r} /></div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-snug text-muted">{BLURB[r.platform]}</p>
      </div>

      <div className="flex-1 px-4 py-3.5"><AccountSlot r={r} planned={planned} /></div>

      <div className="flex min-h-[3.25rem] items-center gap-2 border-t border-hairline px-4 py-2.5">
        {r.state === "connected" ? (
          <>
            {r.ready && <button type="button" className={cbSecondary} onClick={() => onConnect("reconnect")} aria-label={`Reconnect ${label}`}><RefreshCw className="size-3.5" aria-hidden /> Reconnect</button>}
            <button type="button" className={cn(cbDanger, "ml-auto")} onClick={onRemove} aria-label={`Disconnect ${label}`}><Unplug className="size-3.5" aria-hidden /> Disconnect</button>
          </>
        ) : r.state === "pending" ? (
          <>
            {r.ready && <button type="button" className={cbPrimary} onClick={() => onConnect("connect")} aria-label={`Connect ${label}`}><Plug className="size-3.5" aria-hidden /> Connect</button>}
            <button type="button" className={cn(cbDanger, "ml-auto")} onClick={onRemove} aria-label={`Cancel the unfinished ${label} login`}><X className="size-3.5" aria-hidden /> Cancel login</button>
          </>
        ) : r.ready ? (
          <button type="button" className={cn(cbPrimary, "w-full")} onClick={() => onConnect("connect")}><Plug className="size-3.5" aria-hidden /> Connect {label}</button>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted"><Info className="size-3.5" aria-hidden />{planned ? "Not available yet" : "Connect appears once it's set up"}</p>
        )}
      </div>
    </li>
  );
}

/** The account area of a card: who is connected, the unfinished login, or an empty slot. Same height in every state. */
function AccountSlot({ r, planned }: { r: ConnectRow; planned: boolean }) {
  const label = PLATFORM_INFO[r.platform].label;
  const slot = "flex min-h-[3.25rem] items-center gap-2.5 rounded-lg px-2.5 py-2";
  if (r.state === "connected") {
    const a = r.account;
    const handle = a?.handle?.replace(/^@/, "") || null;
    const main = handle ? `@${handle}` : a?.name ?? null;
    const sub = handle && a?.name && a.name.replace(/^@/, "") !== handle ? a.name : null;
    const inner = main ? (
      <>
        <AccountAvatar src={a?.avatar} label={main} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{main}</span>
          {sub && <span className="block truncate text-[11px] text-muted">{sub}</span>}
        </span>
        {a?.url && <ExternalLink className="size-3.5 shrink-0 text-faint" aria-hidden />}
      </>
    ) : (
      <>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-faint"><UserRound className="size-4" aria-hidden /></span>
        <span className="text-[12px] text-muted">Account details appear after the first sync.</span>
      </>
    );
    return (
      <div>
        {a?.url && main
          ? <a href={a.url} target="_blank" rel="noopener noreferrer" title={`Open ${main} on ${label}`} className={cn(slot, "border border-hairline bg-surface-sunken outline-none transition hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent")}>{inner}</a>
          : <div className={cn(slot, "border border-hairline bg-surface-sunken")}>{inner}</div>}
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <Clock className="size-3" aria-hidden />{r.lastSync ? <span>Synced <When iso={r.lastSync} /></span> : "Not synced yet"}
        </p>
      </div>
    );
  }
  if (r.state === "pending") {
    return (
      <div className={cn(slot, "border border-warn/25 bg-warn-soft text-[12px] leading-snug text-warn")}>
        <Clock className="size-4 shrink-0" aria-hidden />
        <span>Login {r.since ? <>started <When iso={r.since} /></> : "started"} but not approved yet. Connect again to finish it.</span>
      </div>
    );
  }
  return (
    <div className={cn(slot, "border border-dashed border-border text-[12px] leading-snug text-muted")}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-faint">
        {r.ready ? <UserRound className="size-4" aria-hidden /> : <Info className="size-4" aria-hidden />}
      </span>
      <span>{r.ready ? "No account connected" : planned ? "Coming soon" : `Needs our ${label} developer app in Composio`}</span>
    </div>
  );
}

/** Profile picture of a connected account; its initial when there is no picture or the platform link has expired. */
export function AccountAvatar({ src, label, size = 28, ring }: { src: string | null | undefined; label: string; size?: number; ring?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, ...(ring ? { boxShadow: `0 0 0 2px var(--surface), 0 0 0 3.5px ${ring}` } : {}) };
  return src && !broken
    // eslint-disable-next-line @next/next/no-img-element -- platform CDN URL that changes; no optimisation needed for a small avatar
    ? <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} style={style} className="shrink-0 rounded-full border border-border object-cover" />
    : <span aria-hidden style={{ ...style, fontSize: Math.round(size * 0.42) }} className="grid shrink-0 place-items-center rounded-full bg-surface-muted font-semibold uppercase text-secondary">{label.replace(/^@/, "").slice(0, 1)}</span>;
}

/* ------------------------------------------------------------------ connect dialog */

/**
 * Connect / Reconnect: what is read and why (from the platform registry) in a dialog, then the platform's own
 * login page, or a login link to send to the account owner.
 */
function useConnectFlow() {
  const [target, setTarget] = useState<{ p: Platform; mode: "connect" | "reconnect" } | null>(null);
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"go" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; copied: boolean } | null>(null);
  useEffect(() => {
    // back from the platform's login page, the browser can restore this page with the dialog still waiting
    const reset = (e: PageTransitionEvent) => { if (e.persisted) { setTarget(null); setAction(null); } };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const open = (p: Platform, mode: "connect" | "reconnect") => { setTarget({ p, mode }); setAction(null); setError(null); setLink(null); };
  const close = () => setTarget(null);
  const run = (kind: "go" | "copy") => {
    if (!target) return;
    const p = target.p;
    setAction(kind);
    setError(null);
    start(async () => {
      const r = await socialConnectLink(p);
      if (!r.ok) { setError(r.error); setAction(null); return; }
      if (kind === "go") { window.location.href = r.url; return; } // stays busy while the platform's page loads
      let copied = false;
      try { await navigator.clipboard.writeText(r.url); copied = true; } catch { /* the link is shown to copy by hand */ }
      setLink({ url: r.url, copied });
      setAction(null);
    });
  };
  return { target, open, close, run, pending, action, error, link, setLink };
}

function ConnectDialog({ flow }: { flow: ReturnType<typeof useConnectFlow> }) {
  const { target, close, run, pending, action, error, link, setLink } = flow;
  const busy = pending || action === "go";
  const p = target?.p;
  const label = p ? PLATFORM_INFO[p].label : "";
  const entry = p ? platformBySocial(p) : null;
  const copyAgain = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setLink({ ...link, copied: true }); } catch { /* select and copy by hand */ }
  };
  return (
    <Dialog
      open={Boolean(target)} onClose={close} busy={busy} icon={p && <PlatformTile platform={p} size={44} />}
      title={link ? `${label} login link` : target?.mode === "reconnect" ? `Reconnect ${label}` : `Connect ${label}`}
      description={link
        ? <>Send it to the person who manages the {label} account. They log in on {label}&apos;s own page and approve read access; the stats appear here once they do.</>
        : <>You&apos;ll log in on {label}&apos;s own page and approve read access. Use the business account, not a personal one.</>}
    >
      <DialogBody>
        {link ? (
          <div>
            <div className="flex gap-2">
              <input readOnly autoFocus aria-label={`${label} login link`} value={link.url} onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent" />
              <button type="button" className={dialogBtn.secondary} onClick={copyAgain}>
                {link.copied ? <Check className="size-4 text-positive" aria-hidden /> : <Copy className="size-4" aria-hidden />} {link.copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p role="status" className="mt-2 text-xs text-muted">{link.copied ? "Copied to your clipboard." : "Copy the link above and send it to the account owner."}</p>
          </div>
        ) : entry ? (
          <ConsentPanel p={entry} className="bg-surface-sunken" />
        ) : null}
        {error && <p role="alert" className="mt-3 rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative">{error}</p>}
      </DialogBody>
      <DialogFooter>
        {link ? (
          <button type="button" className={dialogBtn.primary} onClick={close}>Done</button>
        ) : (
          <>
            <button type="button" className={cn(dialogBtn.ghost, "mr-auto")} onClick={() => run("copy")} disabled={busy} title="For when someone else manages the account">
              {action === "copy" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />} Copy a login link instead
            </button>
            <button type="button" className={dialogBtn.secondary} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" data-autofocus className={dialogBtn.primary} onClick={() => run("go")} disabled={busy}>
              {action === "go" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />} Continue to {label}
            </button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/** Connect button for one platform's section (same dialog and login as the cards). */
export function ConnectOne({ platform, label = "Connect" }: { platform: Platform; label?: string }) {
  const flow = useConnectFlow();
  return (
    <>
      <button type="button" className={`${btn} bg-accent text-accent-foreground hover:opacity-90`} onClick={() => flow.open(platform, label === "Reconnect" ? "reconnect" : "connect")}>
        <Plug className="size-4" aria-hidden /> {label} {PLATFORM_INFO[platform].label}
      </button>
      <ConnectDialog flow={flow} />
    </>
  );
}

/** Removes one platform's login from its section (e.g. a wrong account connected by mistake). */
export function DisconnectOne({ platform }: { platform: Platform }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const label = PLATFORM_INFO[platform].label;
  return (
    <>
      <button type="button" className={`${btn} border border-border text-negative hover:bg-negative-soft`} onClick={() => { setErr(null); setOpen(true); }}>
        <Unplug className="size-4" aria-hidden /> Disconnect {label}
      </button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} busy={pending} error={err} icon={dangerIcon} title={`Disconnect ${label}?`} confirmLabel="Disconnect"
        onConfirm={() => start(async () => { setErr(null); const r = await disconnectSocial(platform); if (r.ok) { setOpen(false); router.refresh(); } else setErr(r.error); })}
      >
        <p>SEO Insights loses access to this {label} account, and the stats read from it are deleted. This can&apos;t be undone.</p>
      </ConfirmDialog>
    </>
  );
}
