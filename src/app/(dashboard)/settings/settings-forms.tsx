"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { Avatar } from "@/components/layout/avatar";
import { createClient } from "@/lib/supabase/client";
import { updateClientSettings, updateProfile, type ActionResult } from "./actions";
import { AvatarEditor } from "./avatar-editor";

const input =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";
const primary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

function Status({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok
    ? <p role="status" className="text-sm text-positive">{result.message}</p>
    : <p role="alert" className="text-sm text-negative">{result.error}</p>;
}

export function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[10px] border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ profile */
export function ProfileForm({ userId, email, fullName, avatarUrl }: {
  userId: string; email: string; fullName: string | null; avatarUrl: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(fullName ?? "");
  const [avatar, setAvatar] = useState(avatarUrl);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  async function changeAvatar(url: string | null) {
    const r = await updateProfile({ fullName: name, avatarUrl: url });
    setResult(r.ok ? { ok: true, message: url ? "Photo updated." : "Photo removed." } : r);
    if (r.ok) { setAvatar(url); router.refresh(); }
  }

  return (
    <div className="space-y-6">
      <AvatarEditor userId={userId} email={email} name={name || null} current={avatar} onChange={changeAvatar} />
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => { setResult(await updateProfile({ fullName: name })); router.refresh(); });
        }}
      >
        <label className="text-sm font-medium">
          Full name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" className={input} />
        </label>
        <label className="text-sm font-medium">
          Email
          <input value={email} disabled className={input} aria-describedby="email-help" />
          <span id="email-help" className="mt-1 block text-xs font-normal text-muted">Your sign-in email can&apos;t be changed here.</span>
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className={primary} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save profile</button>
          <Status result={result} />
        </div>
      </form>
    </div>
  );
}

/* ----------------------------------------------------------------- password */
export function PasswordForm({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (next.length < 8) return setResult({ ok: false, error: "Use at least 8 characters." });
    if (next !== confirm) return setResult({ ok: false, error: "The new passwords don't match." });
    if (next === current) return setResult({ ok: false, error: "Choose a password different from the current one." });
    setBusy(true);
    const supabase = createClient();
    // re-verify the current password before allowing a change
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) { setBusy(false); return setResult({ ok: false, error: "Your current password is incorrect." }); }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return setResult({ ok: false, error: error.message });
    setCurrent(""); setNext(""); setConfirm("");
    setResult({ ok: true, message: "Password changed." });
  }

  const type = show ? "text" : "password";
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm font-medium">Current password
        <input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" className={input} />
      </label>
      <label className="text-sm font-medium">New password
        <input type={type} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" className={input} />
      </label>
      <label className="text-sm font-medium">Confirm new password
        <input type={type} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <button className={primary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Change password</button>
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {show ? "Hide" : "Show"} passwords
        </button>
        <Status result={result} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------- client */
export function ClientForm({ name, timezone, defaultRangeDays, canEdit, timezones }: {
  name: string; timezone: string; defaultRangeDays: number; canEdit: boolean; timezones: string[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          setResult(await updateClientSettings({
            name: String(f.get("name")), timezone: String(f.get("timezone")), defaultRangeDays: Number(f.get("range")),
          }));
          router.refresh();
        });
      }}
    >
      <label className="text-sm font-medium">Client name
        <input name="name" defaultValue={name} required maxLength={120} disabled={!canEdit} className={input} />
      </label>
      <label className="text-sm font-medium">Time zone
        <select name="timezone" defaultValue={timezone} disabled={!canEdit} className={input}>
          {(timezones.includes(timezone) ? timezones : [timezone, ...timezones]).map((tz) => <option key={tz}>{tz}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">Default date range
        <select name="range" defaultValue={String(defaultRangeDays)} disabled={!canEdit} className={input}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
        </select>
      </label>
      <p className="text-xs text-muted sm:col-span-3" title="GA4 figures use the property's own reporting time zone and Search Console uses Pacific Time, as Google reports them.">
        Used for dashboard date ranges. GA4 and Search Console keep their own time zones.
      </p>
      {canEdit ? (
        <div className="flex items-center gap-3 sm:col-span-3">
          <button className={primary} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save client settings</button>
          <Status result={result} />
        </div>
      ) : (
        <p className="text-sm text-muted sm:col-span-3">Only owners and admins can change these.</p>
      )}
    </form>
  );
}

/* --------------------------------------------------------------------- team */
export interface TeamRow { userId: string; email: string; fullName: string | null; avatarUrl: string | null; label: string; inactive: boolean }

/** Who can open the client (read-only). Access is managed in Settings → Organization → Clients and Team members. */
export function ClientTeam({ rows, meId, manageHref }: { rows: TeamRow[]; meId: string; manageHref: string | null }) {
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 p-3">
            <Avatar src={m.avatarUrl} name={m.fullName} email={m.email} size={36} className={m.inactive ? "opacity-50" : undefined} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.fullName || m.email}{m.userId === meId && <span className="ml-1.5 text-xs text-muted">(you)</span>}</p>
              <p className="truncate text-xs text-muted">{m.email}</p>
            </div>
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium">{m.inactive ? "Deactivated" : m.label}</span>
          </li>
        ))}
      </ul>
      {manageHref ? (
        <Link href={manageHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <UserPlus className="size-4" aria-hidden /> Invite people or change who can open this client
        </Link>
      ) : (
        <p className="text-sm text-muted">Organization owners and admins manage who can open each client.</p>
      )}
    </div>
  );
}
