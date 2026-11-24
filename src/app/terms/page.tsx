import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/config/platforms";
import { A, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms and Conditions · SEO Insights",
  description: "The terms for using SEO Insights, the invite-only SEO, analytics and social media reporting platform operated by Waheed Zen LLC.",
  alternates: { canonical: "/terms" },
};

const mail = <a href={`mailto:${SITE.email}`} className={A}>{SITE.email}</a>;

const sections: LegalSection[] = [
  { id: "the-service", title: "The Service", body: <p>SEO Insights is an invite-only analytics platform that combines read-only data from connected accounts (see <Link href="/platforms" className={A}>Connected platforms and permissions</Link>) and third-party search data into dashboards, reports, alerts and AI-assisted recommendations. Access is by invitation for Waheed Zen team members and client businesses&apos; authorized users. A client&apos;s services agreement with Waheed Zen also applies; if it conflicts with these Terms, the services agreement controls.</p> },
  { id: "accounts", title: "Accounts", body: <p>Provide accurate information, keep credentials secure and report unauthorized use promptly to {mail}. Workspace owners and admins control access to their workspace. You are responsible for activity under your account.</p> },
  { id: "connected-accounts", title: "Connected accounts", body: <p>Connect only accounts you own or are authorized to manage, with the owner&apos;s permission. Connections use each platform&apos;s official sign-in or an API key you provide and give <strong>read-only</strong> access; the Service never posts, messages or makes changes. You can disconnect any time in the Service or revoke access on the platform. Your use of each platform remains subject to its own terms.</p> },
  { id: "your-data", title: "Your data", body: <p>You and the businesses you represent keep all rights in your data. You grant Waheed Zen a limited license to host, process and display it only to provide, secure and improve the Service as described in the <Link href="/privacy" className={A}>Privacy Policy</Link>. We do not sell your data or use it for advertising or AI training. Deletion is described on <Link href="/data-deletion" className={A}>Data Deletion</Link>.</p> },
  { id: "acceptable-use", title: "Acceptable use", body: <p>Do not: use the Service unlawfully or against any connected platform&apos;s terms; connect accounts you aren&apos;t authorized to manage; access other workspaces or bypass security; scrape, copy, resell or sublicense the Service or its data; reverse engineer it except as law allows; upload malicious code; or use it to build a competing product.</p> },
  { id: "insights-and-ai", title: "Insights and AI", body: <p>Analytics, estimates and AI-generated recommendations are for information; estimates are not guarantees. Review recommendations before acting. We are not responsible for search engine, platform or algorithm changes, or results depending on factors outside our control.</p> },
  { id: "fees", title: "Fees", body: <p>Access is provided as part of, or alongside, services agreed with Waheed Zen; any fees are set in your agreement or invoice and governed by it.</p> },
  { id: "intellectual-property", title: "Intellectual property", body: <p>The Service, its software, design and content (excluding your data) belong to Waheed Zen LLC and its licensors. You get a limited, non-exclusive, non-transferable right to use it during your access period. We may use feedback without obligation.</p> },
  { id: "third-party-services", title: "Third-party services", body: <p>The Service depends on third-party platforms and providers (e.g. Google, Microsoft, Meta, X, TikTok, Pinterest, LinkedIn, DataForSEO, Anthropic). Their availability, data accuracy and policies are outside our control, and they may change or limit access at any time.</p> },
  { id: "availability-and-changes", title: "Availability and changes", body: <p>We aim for reliable service but don&apos;t guarantee it will be uninterrupted or error-free. We may change features and will give reasonable notice of material reductions in core functionality where practical.</p> },
  { id: "suspension-and-termination", title: "Suspension and termination", body: <p>You may stop using the Service at any time. We may suspend or end access for breach of these Terms, legal or platform requirements, the end of your client relationship with Waheed Zen, or to protect the Service or users. On termination, tokens are deleted and data is deleted as the Privacy Policy describes.</p> },
  { id: "disclaimers", title: "Disclaimers", body: <p>The Service is provided &quot;as is&quot; and &quot;as available&quot;. To the fullest extent permitted by law we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose and non-infringement.</p> },
  { id: "limitation-of-liability", title: "Limitation of liability", body: <p>To the fullest extent permitted by law, Waheed Zen is not liable for indirect, incidental, special, consequential or punitive damages, or lost profits, revenue or data. Total liability for any claim relating to the Service is limited to what you paid Waheed Zen for the Service in the 12 months before the claim, or USD 100 if you paid nothing.</p> },
  { id: "indemnity", title: "Indemnity", body: <p>You will indemnify Waheed Zen against claims arising from your data, accounts you connected without authorization, or your breach of these Terms or law.</p> },
  { id: "governing-law", title: "Governing law and disputes", body: <p>Montana law governs, without regard to conflict-of-law rules. The state and federal courts in Flathead County, Montana have exclusive jurisdiction, and you consent to it.</p> },
  { id: "general", title: "General", body: <p>These Terms, the Privacy Policy and any services agreement are the entire agreement about the Service. Unenforceable provisions don&apos;t affect the rest; non-enforcement is not a waiver. You may not assign these Terms without consent; we may assign to a successor. We may update these Terms by posting a new version with a new date; continued use means acceptance.</p> },
  { id: "contact", title: "Contact", body: <p>{SITE.operator} (SEO Insights) · {SITE.address} · {mail} · <a href={SITE.phoneHref} className={A}>{SITE.phone}</a></p> },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      intro={<p>These Terms govern access to and use of <strong>SEO Insights</strong> (the &quot;Service&quot;), operated by <strong>Waheed Zen LLC</strong>, a Montana limited liability company, {SITE.address} (&quot;Waheed Zen&quot;, &quot;we&quot;, &quot;us&quot;). By signing in or using the Service you agree to these Terms. If you use it on behalf of a business, you confirm you may bind that business.</p>}
      sections={sections}
    />
  );
}
