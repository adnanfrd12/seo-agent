import type { Metadata } from "next";
import Link from "next/link";
import { SITE, deletionMailto } from "@/config/platforms";
import { A, LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { RevokeList } from "@/components/legal/platform-blocks";

export const metadata: Metadata = {
  title: "Data Deletion · SEO Insights",
  description: "How to disconnect an account from SEO Insights and have its data deleted: in the app, on the platform, or by email to Waheed Zen LLC.",
  alternates: { canonical: "/data-deletion" },
};

const sections: LegalSection[] = [
  { id: "disconnect-in-seo-insights", title: "Option 1: Disconnect in SEO Insights (fastest)", body: <p>Sign in and go to {SITE.disconnectPath}, then press <strong>Disconnect</strong> next to the account. The access token is deleted immediately, syncing stops, and the data received from that account is deleted within 30 days (usually immediately).</p> },
  { id: "remove-on-the-platform", title: "Option 2: Remove SEO Insights on the platform", body: <>
    <RevokeList />
    <p>When a platform notifies us that you removed SEO Insights or asked for deletion (Facebook, Instagram, Threads and TikTok send these notifications), or when our next sync finds that access was revoked, we delete that account&apos;s data automatically.</p>
  </> },
  { id: "email-us", title: "Option 3: Email us", body: <p>Email <a href={deletionMailto} className={A}><strong>{SITE.email}</strong></a> with the subject <strong>&quot;Data deletion request&quot;</strong>, including the platform and account username(s) or your workspace email. We may ask you to confirm you control the account. Verified requests are completed within <strong>30 days</strong> and confirmed by email.</p> },
  { id: "check-a-request", title: "Check a request", body: <p>If Meta gave you a confirmation code, check its status on the <Link href="/data-deletion/status" className={A}>deletion status page</Link>.</p> },
  { id: "what-we-delete", title: "What we delete", body: <p>Access tokens and API keys; profile details; statistics, insights and history received from the account; and, if you ask, your SEO Insights user account and workspace. Backups are overwritten within {SITE.backupDays} days. We keep only a minimal record that the request was completed.</p> },
  { id: "questions", title: "Questions", body: <p>{SITE.operator} (SEO Insights), {SITE.address} · <a href={`mailto:${SITE.email}`} className={A}>{SITE.email}</a> · <a href={SITE.phoneHref} className={A}>{SITE.phone}</a> · <Link href="/privacy" className={A}>Privacy Policy</Link></p> },
];

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion" eyebrow="Your data" numbered={false} sections={sections}
      intro={<p>SEO Insights is operated by Waheed Zen LLC. All access to your accounts is read-only, and you can stop sharing data and have it deleted at any time.</p>} />
  );
}
