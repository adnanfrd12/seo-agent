"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Plug, RefreshCw, Search, Settings2, X } from "lucide-react";
import { detectSocialProfiles, disconnectSocial, refreshSocialNow, saveSocialSettings, socialConnectLink } from "@/app/(dashboard)/social/actions";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "@/lib/social/platforms";

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
            <p className="text-xs text-muted">Tokens are encrypted and never shown again. Leave a token field empty to keep what is stored.</p>
          </div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}

export interface ConnectRow { platform: Platform; state: "connected" | "pending" | "none"; ready: boolean; note: string | null }

/** One Connect button per platform: the owner logs in on the platform's own page through Composio (official OAuth). */
export function SocialConnect({ rows, canEdit }: { rows: ConnectRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Platform | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [link, setLink] = useState<{ p: Platform; url: string } | null>(null);
  if (!canEdit) return null;
  const go = (p: Platform, copy: boolean) => {
    setBusy(p);
    start(async () => {
      setMsg(null);
      const r = await socialConnectLink(p);
      setBusy(null);
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      if (!copy) { window.location.href = r.url; return; }
      setLink({ p, url: r.url });
      try { await navigator.clipboard.writeText(r.url); setMsg({ ok: true, text: `${PLATFORM_INFO[p].label} link copied. Send it to the account owner; once they log in, the stats appear here.` }); }
      catch { setMsg({ ok: true, text: "Copy the link below and send it to the account owner." }); }
    });
  };
  const remove = (p: Platform) => {
    if (!window.confirm(`Disconnect ${PLATFORM_INFO[p].label}? Stats already read are kept.`)) return;
    setBusy(p);
    start(async () => {
      const r = await disconnectSocial(p);
      setBusy(null);
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });
  };
  const small = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-60";
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Plug className="size-4" /> Connect social accounts</h2>
      <p className="mt-0.5 max-w-2xl text-xs text-muted">The account owner logs in on the platform&apos;s own page (through Composio) and approves read access. Connected accounts give full analytics: followers, reach, impressions, views and engagement. Accounts that aren&apos;t connected show public numbers only.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => (
          <li key={r.platform} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{PLATFORM_INFO[r.platform].label}</span>
              {r.state === "connected" ? <span className="rounded bg-positive/15 px-1.5 py-0.5 text-[11px] text-positive">Connected</span>
                : r.state === "pending" ? <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">Login not finished</span>
                : <span className="text-[11px] text-faint">Not connected</span>}
            </div>
            {r.ready ? (
              <div className="flex flex-wrap gap-1.5">
                <button className={`${small} bg-accent text-accent-foreground hover:opacity-90`} disabled={pending} onClick={() => go(r.platform, false)}>
                  {busy === r.platform ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} {r.state === "connected" ? "Reconnect" : "Connect"}
                </button>
                <button className={`${small} border border-border hover:bg-surface-muted`} disabled={pending} onClick={() => go(r.platform, true)} title="Copy a login link to send to the account owner"><Copy className="size-3.5" /> Link</button>
                {r.state !== "none" && <button className={`${small} text-faint hover:text-negative`} disabled={pending} onClick={() => remove(r.platform)} aria-label={`Disconnect ${PLATFORM_INFO[r.platform].label}`}><X className="size-3.5" /></button>}
              </div>
            ) : <p className="text-[11px] text-warn">Needs a one-time developer app in Composio (see the note below).</p>}
          </li>
        ))}
      </ul>
      {rows.some((r) => !r.ready) && <p className="mt-3 text-xs text-muted">{rows.filter((r) => !r.ready).map((r) => r.note).join(" ")}</p>}
      {link && <input readOnly aria-label="Login link" value={link.url} onFocus={(e) => e.currentTarget.select()} className="mt-3 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs" />}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}
