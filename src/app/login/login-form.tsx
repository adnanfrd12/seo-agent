"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { GoogleG } from "@/components/brand/google-icons";
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
  "w-full rounded-xl border border-[#E7E2DD] bg-white py-3 pl-11 pr-3 text-[15px] text-[#16161a] outline-none transition placeholder:text-[#9a9aa5] hover:border-[#D9D2CB] focus-visible:border-[#F26A1B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/15";

type Notice = { kind: "error" | "info"; text: string } | null;

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const remembered = useSyncExternalStore(noopSubscribe, readRemembered, () => "");
  // null = untouched, so the remembered value (read after hydration) shows through
  const [emailInput, setEmailInput] = useState<string | null>(null);
  const [rememberInput, setRememberInput] = useState<boolean | null>(null);
  const email = emailInput ?? remembered;
  const remember = rememberInput ?? remembered !== "";

  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialError ? { kind: "error", text: initialError } : null);
  const [busy, setBusy] = useState<null | "password" | "google" | "reset">(null);

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
    router.replace(next);
    router.refresh();
  }

  async function onGoogle() {
    setBusy("google");
    setNotice(null);
    // Ask the auth server first whether Google is switched on: if it isn't, Supabase would show a raw JSON error page.
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      });
      const settings = (await res.json()) as { external?: Record<string, boolean> };
      if (settings.external && settings.external.google === false) {
        setBusy(null);
        return setNotice({
          kind: "info",
          text: "Google sign-in isn't enabled for this workspace yet. Please sign in with your email and password.",
        });
      }
    } catch { /* settings unavailable: let Supabase handle it below */ }

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setBusy(null);
      setNotice({ kind: "error", text: error.message });
    }
    // on success the browser is already navigating to Google
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

  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
  const requestAccess = `mailto:${contact}?subject=${encodeURIComponent(`${BRAND_NAME} access request`)}`;

  return (
    <div className="relative w-full rounded-[28px] border border-[#F0EBE6] bg-white p-6 shadow-[0_30px_80px_-30px_rgba(120,60,20,0.25),0_8px_24px_-12px_rgba(0,0,0,0.08)] sm:p-9">
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-8" />
          <span className="text-[22px] font-bold tracking-tight text-[#16161a]">{BRAND_NAME}</span>
        </div>
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8a8a94]">SEO Analytics Platform</p>
      </div>

      <h1 className="mt-7 text-center text-[28px] font-bold tracking-tight text-[#16161a]">Welcome Back</h1>
      <p className="mx-auto mt-2 max-w-[19rem] text-center text-[15px] leading-relaxed text-[#6b6b76]">
        Sign in to your account to view your SEO performance and reports.
      </p>

      <button type="button" onClick={onGoogle} disabled={busy !== null}
        className="group mt-7 flex w-full items-center justify-center gap-3 rounded-xl border border-[#E7E2DD] bg-white py-3 text-[15px] font-semibold text-[#16161a] outline-none transition hover:border-[#D9D2CB] hover:bg-[#FCFAF8] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/20 disabled:opacity-60">
        <GoogleG />
        {busy === "google" ? "Connecting to Google…" : "Continue with Google"}
        <ArrowRight className="size-4 text-[#8a8a94] transition group-hover:translate-x-0.5" aria-hidden />
      </button>

      <div className="my-5 flex items-center gap-4 text-xs font-semibold text-[#9a9aa5]" aria-hidden>
        <span className="h-px flex-1 bg-[#EEE9E4]" /> OR <span className="h-px flex-1 bg-[#EEE9E4]" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
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

        <button type="submit" disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F26A1B] to-[#E8452C] py-3.5 text-base font-semibold text-white shadow-lg shadow-[#E8452C]/30 outline-none transition hover:brightness-105 active:brightness-95 focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30 disabled:opacity-60">
          {busy === "password" ? "Signing in…" : <>Sign In <ArrowRight className="size-[18px]" aria-hidden /></>}
        </button>
      </form>

      <div className="my-6 flex items-center gap-4 text-sm text-[#8a8a94]">
        <span className="h-px flex-1 bg-[#EEE9E4]" aria-hidden /> New to {BRAND_NAME}? <span className="h-px flex-1 bg-[#EEE9E4]" aria-hidden />
      </div>

      <a href={requestAccess} aria-describedby="access-note"
        className="flex w-full items-center justify-center rounded-xl border-[1.5px] border-[#F26A1B] bg-white py-3 text-[15px] font-semibold text-[#E8552A] outline-none transition hover:bg-[#FFF5EE] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/20">
        Create an account
      </a>
      <p id="access-note" className="mt-2.5 text-center text-xs text-[#8a8a94]">
        Accounts are set up by invitation. This opens an email to request access.
      </p>
    </div>
  );
}
