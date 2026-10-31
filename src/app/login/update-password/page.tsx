import type { Metadata } from "next";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import styles from "../login.module.css";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: `Set a new password · ${BRAND_NAME}` };

/** Landing page of the "Forgot password?" email: /auth/callback signs the user in, then sends them here. */
export default function UpdatePasswordPage() {
  return (
    <main className={`${styles.page} relative flex min-h-screen flex-1 items-center justify-center bg-[#FFFCF9] px-4 py-12 text-[#16161a]`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 size-[32rem] rounded-full bg-[#FFD9BF]/60 blur-3xl" />
        <div className="absolute -right-40 bottom-0 size-[28rem] rounded-full bg-[#FFE3D1]/70 blur-3xl" />
      </div>
      <div className={`${styles.enter} relative w-full max-w-[440px] rounded-[28px] border border-[#F0EBE6] bg-white p-6 shadow-[0_30px_80px_-30px_rgba(120,60,20,0.25)] sm:p-9`}>
        <div className="flex items-center justify-center gap-2.5">
          <BrandMark className="h-8" />
          <span className="text-[22px] font-bold tracking-tight">{BRAND_NAME}</span>
        </div>
        <h1 className="mt-7 text-center text-[26px] font-bold tracking-tight">Set a new password</h1>
        <p className="mt-2 text-center text-[15px] text-[#6b6b76]">Choose a new password for your account.</p>
        <UpdatePasswordForm />
      </div>
    </main>
  );
}
