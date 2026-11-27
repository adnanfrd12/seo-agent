"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Lock, Mail, MailCheck, User } from "lucide-react";
import { acceptInvite, sendInviteSignInLink, signOutForInvite } from "./actions";

const field =
  "w-full rounded-xl border border-[#E7E2DD] bg-white py-3 pl-11 pr-3 text-[15px] text-[#16161a] outline-none transition placeholder:text-[#9a9aa5] focus-visible:border-[#F26A1B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/15";
const primary =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F26A1B] to-[#E8452C] py-3.5 text-base font-semibold text-white shadow-lg shadow-[#E8452C]/30 outline-none transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30 disabled:opacity-60";

function Err({ text }: { text: string | null }) {
  return text ? <p role="alert" className="rounded-xl border border-[#F7D4CC] bg-[#FDF1EE] p-3 text-sm text-[#B4321F]">{text}</p> : null;
}

function Input({ id, label, icon: Icon, ...rest }: { id: string; label: string; icon: typeof Lock } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#9a9aa5]" aria-hidden />
        <input id={id} {...rest} className={field} />
      </div>
    </div>
  );
}

/**
 * The invitation's next step for this visitor: accept (signed in with the invited address, choosing a password if
 * the account is new), switch account (signed in as someone else), sign in (an existing account), or confirm the
 * address with a sign-in link emailed to it (no usable account yet). Holding the link alone never signs anyone in.
 */
export function AcceptInvite({ token, maskedEmail, signedIn, step, expires }: {
  token: string; maskedEmail: string; expires: string;
  signedIn: { email: string; matches: boolean; needsPassword: boolean } | null; step: "email_link" | "sign_in" | null;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const next = `/invite/${token}`;

  if (signedIn && !signedIn.matches) {
    return (
      <div className="mt-7 space-y-4">
        <p className="rounded-xl border border-[#F3E3D6] bg-[#FFF8F2] p-3 text-sm text-[#6b4a32]">
          You&apos;re signed in as <strong>{signedIn.email}</strong>, but this invitation is for <strong>{maskedEmail}</strong>.
        </p>
        <form action={signOutForInvite.bind(null, token)}>
          <button className={primary}>Sign out and continue <ArrowRight className="size-[18px]" aria-hidden /></button>
        </form>
      </div>
    );
  }

  if (signedIn) {
    return (
      <form className="mt-7 space-y-4" onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (signedIn.needsPassword) {
          if (password.length < 8) return setError("Use at least 8 characters for your password.");
          if (password !== confirm) return setError("The two passwords don't match.");
        }
        start(async () => {
          const r = await acceptInvite(token, signedIn.needsPassword ? { password, fullName: name } : {});
          // a full page load, so the organization just joined opens at once
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          if (r.ok) window.location.assign("/overview"); else setError(r.error);
        });
      }}>
        <p className="text-center text-sm text-[#6b6b76]">Signed in as <strong className="text-[#16161a]">{signedIn.email}</strong></p>
        {signedIn.needsPassword && (
          <>
            <p className="text-sm text-[#6b6b76]">Your address is confirmed. Choose a password to finish setting up your account.</p>
            <Input id="full-name" label="Your name" icon={User} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input id="new-password" label="Choose a password" icon={Lock} type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input id="confirm-password" label="Confirm password" icon={Lock} type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </>
        )}
        <Err text={error} />
        <button className={primary} disabled={pending}>{pending ? "Joining…" : <>Accept and join <ArrowRight className="size-[18px]" aria-hidden /></>}</button>
        <p className="text-center text-xs text-[#8a8a93]">Valid until {expires}.</p>
      </form>
    );
  }

  if (step === "email_link") {
    return (
      <div className="mt-7 space-y-4">
        {sent ? (
          <p role="status" className="flex gap-2.5 rounded-xl border border-[#D6EBDD] bg-[#F1FAF4] p-3 text-sm text-[#1D5E3A]">
            <MailCheck className="mt-0.5 size-[18px] shrink-0" aria-hidden /> <span>{sent} If it doesn&apos;t arrive, check your spam folder.</span>
          </p>
        ) : (
          <p className="text-center text-sm text-[#6b6b76]">
            <strong className="block text-base text-[#16161a]">Confirm it&apos;s you</strong>
            We&apos;ll email a sign-in link to <strong className="text-[#16161a]">{maskedEmail}</strong>. Open it to continue here.
          </p>
        )}
        <Err text={error} />
        <button type="button" className={primary} disabled={pending} onClick={() => start(async () => {
          setError(null);
          const r = await sendInviteSignInLink(token);
          if (r.ok) setSent(r.message ?? "We've emailed you a sign-in link."); else setError(r.error);
        })}>
          <Mail className="size-[18px]" aria-hidden /> {pending ? "Sending…" : sent ? "Send it again" : "Email me a sign-in link"}
        </button>
        <p className="text-center text-xs text-[#8a8a93]">Valid until {expires}. Already have a password? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-[#EA5A22] hover:underline">Sign in</Link></p>
      </div>
    );
  }

  return (
    <div className="mt-7 space-y-4">
      <p className="text-center text-sm text-[#6b6b76]">Sign in as <strong className="text-[#16161a]">{maskedEmail}</strong> to accept. Forgot your password? Use “Forgot password?” on the sign-in page.</p>
      <Link href={`/login?next=${encodeURIComponent(next)}`} className={primary}>Sign in to accept <ArrowRight className="size-[18px]" aria-hidden /></Link>
      <p className="text-center text-xs text-[#8a8a93]">Valid until {expires}.</p>
    </div>
  );
}
