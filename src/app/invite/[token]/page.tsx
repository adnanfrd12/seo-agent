import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import styles from "@/app/login/login.module.css";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { accountStep, awaitingPassword, findInvitation, inviteThrottled, maskEmail, noteInviteMiss } from "@/lib/org/invitations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AcceptInvite } from "./accept-invite";

// the token is in the address: never send it on as a referrer, never index the page
export const metadata: Metadata = { title: `Invitation · ${BRAND_NAME}`, referrer: "no-referrer", robots: { index: false, follow: false } };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className={`${styles.page} relative flex min-h-screen flex-1 items-center justify-center bg-[#FFFCF9] px-4 py-12 text-[#16161a]`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 size-[32rem] rounded-full bg-[#FFD9BF]/60 blur-3xl" />
        <div className="absolute -right-40 bottom-0 size-[28rem] rounded-full bg-[#FFE3D1]/70 blur-3xl" />
      </div>
      <div className={`${styles.enter} relative w-full max-w-[460px] rounded-[28px] border border-[#F0EBE6] bg-white p-6 shadow-[0_30px_80px_-30px_rgba(120,60,20,0.25)] sm:p-9`}>
        <div className="flex items-center justify-center gap-2.5">
          <BrandMark className="h-8" />
          <span className="text-[22px] font-bold tracking-tight">{BRAND_NAME}</span>
        </div>
        {children}
      </div>
    </main>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <h1 className="mt-7 text-center text-[24px] font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-center text-[15px] text-[#6b6b76]">{body}</p>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="font-semibold text-[#EA5A22] hover:underline">Go to sign in</Link></p>
    </Frame>
  );
}

/**
 * /invite/<token>: join an organization. Public: the link shows the invitation, but accepting needs a session for
 * the invited address (sign in, or confirm the address with an emailed sign-in link). The invitation is
 * found by the token's hash only; see src/lib/org/invitations.ts for the rules.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const visitor = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (inviteThrottled(visitor)) return <Problem title="Too many attempts" body="Try the link again in a few minutes." />;

  const admin = createAdminClient();
  const inv = await findInvitation(admin, token);
  if (!inv) {
    noteInviteMiss(visitor);
    return <Problem title="This link isn't valid" body="Check that you copied the whole link, or ask for a new invitation." />;
  }
  if (inv.state === "expired") return <Problem title="This invitation has expired" body={`Ask ${inv.inviterName ?? "the person who invited you"} to send a new one.`} />;
  if (inv.state === "revoked") return <Problem title="This invitation was withdrawn" body="Ask the organization for a new invitation if you still need access." />;
  if (inv.state === "accepted") return <Problem title="Already accepted" body="This invitation has been used. Sign in to open the organization." />;

  const { data } = await (await createClient()).auth.getClaims();
  const userId = data?.claims?.sub;
  const me = userId ? (await admin.auth.admin.getUserById(userId)).data.user : null;
  const signedIn = me ? { email: me.email ?? "", matches: (me.email ?? "").toLowerCase() === inv.email.toLowerCase(), needsPassword: awaitingPassword(me) } : null;
  const step = signedIn ? null : await accountStep(admin, inv);

  return (
    <Frame>
      <h1 className="mt-7 text-center text-[26px] font-bold leading-tight tracking-tight">Join {inv.orgName}</h1>
      <p className="mt-2 text-center text-[15px] text-[#6b6b76]">
        {inv.inviterName ? `${inv.inviterName} invited you` : "You're invited"} as <strong className="font-semibold text-[#16161a]">{inv.roleLabel}</strong>.
      </p>
      {inv.clients.length > 0 && (
        <div className="mt-5 rounded-xl border border-[#F0EBE6] bg-[#FFFCF9] p-3 text-sm">
          <p className="font-semibold">Clients you&apos;ll see</p>
          <ul className="mt-1.5 space-y-0.5 text-[#55555e]">
            {inv.clients.slice(0, 8).map((c) => <li key={c.name} className="flex justify-between gap-3"><span className="truncate">{c.name}</span><span className="shrink-0 text-xs text-[#8a8a93]">{c.role}</span></li>)}
            {inv.clients.length > 8 && <li className="text-xs text-[#8a8a93]">and {inv.clients.length - 8} more</li>}
          </ul>
        </div>
      )}
      <AcceptInvite token={token} maskedEmail={maskEmail(inv.email)} signedIn={signedIn} step={step}
        expires={new Date(inv.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} />
    </Frame>
  );
}
