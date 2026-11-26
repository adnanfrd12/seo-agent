"use client";

import { useState, useSyncExternalStore } from "react";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** "Remember me" only remembers the email address on this device. Sessions persist either way. */
const REMEMBER_KEY = "seo-insights:remembered-email";

function readRemembered(): string {
  try { return window.localStorage.getItem(REMEMBER_KEY) ?? ""; } catch { return ""; }
}
function writeRemembered(email: string | null) {
  try {
    if (email) window.localStorage.setItem(REMEMBER_KEY, email);
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch { /* storage blocked (private mode): nothing to remember */ }
}
const noopSubscribe = () => () => {};

const field =
  "w-full rounded-lg border border-[#E2DAD2] bg-white py-3 pl-11 pr-3 text-[15px] text-[#16161a] outline-none transition placeholder:text-[#9a9aa5] hover:border-[#D9D2CB] focus-visible:border-[#F26A1B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/15";

type Notice = { kind: "error" | "info"; text: string } | null;

const ERRORS: Record<string, string> = {
  callback: "That sign-in link didn't work. It may have expired or already been used. Please try again.",
};
/** Same-site paths only, so ?next= can't send people to another site after signing in. */
const safeNext = (raw: string | null) => (raw && /^\/(?![/\\])/.test(raw) ? raw : "/overview");

const readSearch = () => window.location.search;
/** The form with ?next= and ?error= read in the browser after load (keeps the login page fully static, with no
 * Suspense boundary to stream: the form is interactive as soon as the page's script runs). */
export function LoginFormWithParams() {
  const search = useSyncExternalStore(noopSubscribe, readSearch, () => "");
  const sp = new URLSearchParams(search);
  const errorKey = sp.get("error");
  // keyed by the query: the form remounts once the browser has read it, so ?error= shows (nothing typed yet then)
  return <LoginForm key={search} next={safeNext(sp.get("next"))} initialError={errorKey ? ERRORS[errorKey] ?? ERRORS.callback : null} />;
}

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const remembered = useSyncExternalStore(noopSubscribe, readRemembered, () => "");
  // false until the page's JavaScript has loaded: before that, pressing Sign in would make the browser submit the
  // form itself (reloading the page, nothing signed in), so the button waits
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  // null = untouched, so the remembered value (read after hydration) shows through
  const [emailInput, setEmailInput] = useState<string | null>(null);
  const [rememberInput, setRememberInput] = useState<boolean | null>(null);
  const email = emailInput ?? remembered;
  const remember = rememberInput ?? remembered !== "";

  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialError ? { kind: "error", text: initialError } : null);
  const [busy, setBusy] = useState<null | "password" | "reset">(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setNotice(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(null);
      return setNotice({ kind: "error", text: error.message });
    }
    writeRemembered(remember ? email : null);
    // A full page load, not a client-side route change: it always carries the session cookie that was just set,
    // so the dashboard opens on the first try (a soft navigation could race the cookie and land back here).
    // The button keeps saying "Signing in…" until the dashboard replaces this page.
    window.location.assign(next);
  }

  async function onForgot() {
    setNotice(null);
    const input = document.getElementById("email") as HTMLInputElement | null;
    if (!email || (input && !input.checkValidity())) {
      input?.focus();
      return setNotice({ kind: "info", text: "Enter your email address above, then choose “Forgot password?” again." });
    }
    setBusy("reset");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login/update-password")}`;
    const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(null);
    if (error) return setNotice({ kind: "error", text: error.message });
    setNotice({
      kind: "info",
      text: `If an account exists for ${email}, a password reset link is on its way. Check your inbox (and spam folder).`,
    });
  }

  return (
    <div className="w-full">
      <h1 className="font-[family-name:var(--font-public-serif)] text-[2.6rem] leading-none tracking-[-0.01em] text-[#17120E]">Sign in</h1>

      {/* method="post": even a submit before the script loads never puts the email and password in the URL */}
      <form onSubmit={onSubmit} method="post" className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-[#16161a]">Email address</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#9a9aa5]" aria-hidden />
            <input id="email" name="email" type="email" required autoComplete="email" placeholder="Enter your email"
              value={email} onChange={(e) => setEmailInput(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-[#16161a]">Password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#9a9aa5]" aria-hidden />
            <input id="password" name="password" type={show ? "text" : "password"} required autoComplete="current-password"
              placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)}
              className={`${field} pr-11`} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show} aria-controls="password"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#9a9aa5] outline-none hover:text-[#16161a] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">
              {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-[#3a3a42]" title="Remembers your email address on this device">
            <input type="checkbox" checked={remember} onChange={(e) => setRememberInput(e.target.checked)}
              className="size-4 cursor-pointer rounded accent-[#F26A1B]" />
            Remember me
          </label>
          <button type="button" onClick={onForgot} disabled={busy !== null}
            className="font-semibold text-[#EA5A22] outline-none hover:underline focus-visible:underline disabled:opacity-60">
            {busy === "reset" ? "Sending link…" : "Forgot password?"}
          </button>
        </div>

        <div aria-live="polite">
          {notice && (
            <p role={notice.kind === "error" ? "alert" : "status"}
              className={notice.kind === "error"
                ? "rounded-xl border border-[#F7D4CC] bg-[#FDF1EE] p-3 text-sm text-[#B4321F]"
                : "rounded-xl border border-[#F3E3D6] bg-[#FFF8F2] p-3 text-sm text-[#6b4a32]"}>
              {notice.text}
            </p>
          )}
        </div>

        <button type="submit" disabled={busy !== null || !ready}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#17120E] py-3.5 text-[15px] font-semibold text-white hover:bg-[#2A221B] outline-none transition focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30 disabled:opacity-60">
          {busy === "password" ? "Signing in…" : !ready ? "Loading…" : <>Sign in <ArrowRight className="size-[18px]" aria-hidden /></>}
        </button>
      </form>

    </div>
  );
}
