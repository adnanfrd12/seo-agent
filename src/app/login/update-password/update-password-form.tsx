"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const field =
  "w-full rounded-xl border border-[#E7E2DD] bg-white py-3 pl-11 pr-3 text-[15px] text-[#16161a] outline-none transition placeholder:text-[#9a9aa5] focus-visible:border-[#F26A1B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/15";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setBusy(false);
      return setError("This reset link has expired or was already used. Request a new one from the sign-in page.");
    }
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/overview");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-7 space-y-4">
      <div>
        <label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold">New password</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#9a9aa5]" aria-hidden />
          <input id="new-password" type="password" required minLength={6} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold">Confirm new password</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#9a9aa5]" aria-hidden />
          <input id="confirm-password" type="password" required minLength={6} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-[#F7D4CC] bg-[#FDF1EE] p-3 text-sm text-[#B4321F]">{error}</p>}
      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F26A1B] to-[#E8452C] py-3.5 text-base font-semibold text-white shadow-lg shadow-[#E8452C]/30 outline-none transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30 disabled:opacity-60">
        {busy ? "Saving…" : <>Save password <ArrowRight className="size-[18px]" aria-hidden /></>}
      </button>
      <p className="text-center text-sm">
        <Link href="/login" className="font-semibold text-[#EA5A22] hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}
