"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { detectSocialProfiles, refreshSocialNow, saveSocialSettings } from "@/app/(dashboard)/social/actions";
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
