"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChartNoAxesColumn, Eye, EyeOff, Lock, Mail, ShieldCheck, Users } from "lucide-react";
import { BrandLockup } from "@/components/brand/brand-mark";
import { GoogleG } from "@/components/brand/google-icons";
import { createClient } from "@/lib/supabase/client";

const field =
  "w-full rounded-xl border border-border bg-surface py-3 pl-11 pr-3 text-[15px] outline-none transition placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/overview");
    router.refresh();
  }

  return (
    <div className="relative w-full rounded-3xl border border-border bg-surface/95 p-6 shadow-2xl shadow-black/[0.07] backdrop-blur sm:p-10 lg:p-8 xl:p-10">
      {/* thin brand-gradient accent along the top edge */}
      <div aria-hidden className="absolute inset-x-10 top-0 h-[3px] rounded-b-full bg-gradient-to-r from-[#F2701E] to-[#E8452C]" />
      <BrandLockup stacked size="md" tagline="Client Analytics Dashboard" />

      <h1 className="mt-8 text-center text-3xl font-bold tracking-tight">Welcome Back</h1>
      <p className="mx-auto mt-2 max-w-xs text-center text-[15px] leading-relaxed text-muted">
        Sign in to your account to view your SEO performance and reports.
      </p>

      {/* Visual only for now: the Google sign-in flow is intentionally not implemented yet. */}
      <button
        type="button" disabled aria-disabled="true" title="Google sign-in is coming soon"
        className="mt-7 flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-border bg-surface py-3 text-[15px] font-semibold opacity-70"
      >
        <GoogleG /> Continue with Google
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Soon</span>
      </button>

      <div className="my-5 flex items-center gap-4 text-xs font-medium text-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" /> OR <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input id="email" type="email" required autoComplete="email" placeholder="Enter your email"
              value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">Password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input id="password" type={show ? "text" : "password"} required autoComplete="current-password"
              placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)}
              className={`${field} pr-11`} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
              {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          {/* Sessions already persist on this device, so this is shown checked and read-only. */}
          <label className="flex items-center gap-2 text-foreground/90" title="You stay signed in on this device">
            <input type="checkbox" checked readOnly disabled className="size-4 accent-[var(--accent)]" /> Remember me
          </label>
          <button type="button" onClick={() => setHint("Password reset isn't available yet. Ask your administrator to reset it in Supabase.")}
            className="font-medium text-accent outline-none hover:underline focus-visible:underline">
            Forgot password?
          </button>
        </div>

        {hint && <p role="status" className="rounded-lg bg-surface-muted p-2.5 text-sm text-muted">{hint}</p>}
        {error && <p role="alert" className="rounded-lg bg-accent-soft p-2.5 text-sm text-negative">{error}</p>}

        <button disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F2701E] to-[#E8452C] py-3.5 text-base font-semibold text-white shadow-lg shadow-[#E8452C]/25 outline-none transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60">
          {busy ? "Signing in…" : <>Sign In <ArrowRight className="size-[18px]" aria-hidden /></>}
        </button>
      </form>

      <ul className="mt-8 grid grid-cols-3 divide-x divide-border text-center">
        {[
          { icon: ShieldCheck, title: "Secure Access", sub: "Your data is safe" },
          { icon: ChartNoAxesColumn, title: "Daily Sync", sub: "Direct from Google" },
          { icon: Users, title: "Client Focused", sub: "Built for agencies" },
        ].map(({ icon: Icon, title, sub }) => (
          <li key={title} className="px-2">
            <Icon className="mx-auto size-6 text-foreground/80" aria-hidden />
            <p className="mt-2 text-[13px] font-semibold">{title}</p>
            <p className="text-xs text-muted">{sub}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
