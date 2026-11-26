"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { ConfirmButton } from "@/components/dashboard/dialog";
import { removeGoogleApp, saveGoogleApp } from "@/app/(dashboard)/integrations/gbp-actions";

const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";

/**
 * "Your Google API credentials": each agency owner saves their own Google Cloud OAuth client (ID + secret). The
 * secret goes to the server once and is stored encrypted; it is never shown again.
 */
export function GbpCredentials({ canEdit, own, inUse, redirectUri }: {
  canEdit: boolean;
  /** the signed-in user's saved app (client id only) */
  own: { clientId: string; updatedAt: string } | null;
  /** which app a new connection for this client would use */
  inUse: "own" | "client_owner" | "env" | "none";
  redirectUri: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) { setOpen(false); setSecret(""); setId(""); router.refresh(); }
    });

  const using = {
    own: "New connections for this client use your saved credentials.",
    client_owner: "New connections for this client use the client owner's saved credentials.",
    env: "New connections use the app configured on the server.",
    none: "No credentials yet: save yours to connect Business Profile.",
  }[inUse];

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium"><KeyRound className="size-4 text-muted" aria-hidden /> Your Google API credentials</p>
        {own && <span className="text-xs text-muted">Saved {new Date(own.updatedAt).toLocaleDateString()}</span>}
      </div>
      <p className="text-muted">{own ? <>Client ID <span className="break-all font-mono text-xs text-foreground">{own.clientId}</span>. </> : null}{using}</p>
      {canEdit && !open && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn2} onClick={() => { setOpen(true); setMsg(null); }}>{own ? "Replace credentials" : "Add credentials"}</button>
          {own && (
            <ConfirmButton className={btn2} onConfirm={() => run(removeGoogleApp)} title="Remove your Google credentials?" confirmLabel="Remove"
              body={<p>Business Profile connections made with them stop syncing until they are reconnected with other credentials.</p>}>Remove</ConfirmButton>
          )}
        </div>
      )}
      {canEdit && open && (
        <form className="space-y-2 rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); run(() => saveGoogleApp(id, secret)); }}>
          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted">
            <li>Google Cloud console → APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Web application.</li>
            <li>Add this Authorized redirect URI:
              <span className="mt-1 flex items-center gap-1.5">
                <code className="break-all rounded bg-surface-muted px-1.5 py-0.5 text-foreground">{redirectUri}</code>
                <button type="button" aria-label="Copy redirect URI" className="shrink-0 text-muted hover:text-foreground" onClick={() => navigator.clipboard?.writeText(redirectUri)}><Copy className="size-3.5" /></button>
              </span>
            </li>
            <li>Enable the Business Profile APIs and request access (quota) for the same project.</li>
          </ol>
          <label className="block text-xs font-medium" htmlFor="gbp-cid">OAuth client ID</label>
          <input id="gbp-cid" className={input} value={id} onChange={(e) => setId(e.target.value)} placeholder="1234567890-abc.apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
          <label className="block text-xs font-medium" htmlFor="gbp-secret">Client secret</label>
          <input id="gbp-secret" type="password" className={input} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" autoComplete="off" />
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={pending || !id.trim() || !secret.trim()}>{pending && <Loader2 className="size-4 animate-spin" />} Check and save</button>
            <button type="button" className={btn2} onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-positive" : "text-negative"}>{msg.text}</p>}
    </div>
  );
}
