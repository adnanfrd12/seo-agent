import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/config/platforms";
import { A, LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { PolicyRefs, PrivacyPlatforms, ProcessorTable } from "@/components/legal/platform-blocks";

export const metadata: Metadata = {
  title: "Privacy Policy · SEO Insights",
  description: "How SEO Insights, operated by Waheed Zen LLC, collects, uses, shares and deletes information, including read-only data from connected Google, Microsoft and social accounts.",
  alternates: { canonical: "/privacy" },
};

const mail = <a href={`mailto:${SITE.email}`} className={A}>{SITE.email}</a>;

const sections: LegalSection[] = [
  { id: "what-seo-insights-is", title: "What SEO Insights is", body: <>
    <p>SEO Insights is an invite-only platform that Waheed Zen LLC uses to report on search, website, business-listing and social media performance for its client businesses. Team members and client users are invited; there is no public sign-up. Every connection to a third-party platform is <strong>read-only</strong>: we never post, comment, message, follow, upload or change anything on any connected account.</p>
  </> },
  { id: "information-we-collect", title: "Information we collect", body: <>
    <p><strong>Account information:</strong> name, email, role, the business (workspace) you belong to and sign-in details.</p>
    <p><strong>Connected account data:</strong> when an authorized person connects a business account through the platform&apos;s official sign-in (OAuth) or an API key, we receive only the read-only data listed for that platform:</p>
    <PrivacyPlatforms />
    <p><strong>Market and search data:</strong> keyword volumes, search results, competitor and backlink data from DataForSEO. It concerns search terms and websites, not individuals.</p>
    <p><strong>Usage and technical data:</strong> log data (IP address, browser, device, pages, timestamps, errors) to run, secure and troubleshoot the service. We do not use product analytics or tracking tools on SEO Insights.</p>
    <p><strong>Communications:</strong> messages, support requests and deletion requests you send us.</p>
    <p>We do not collect payment card details in SEO Insights and do not knowingly collect sensitive personal information.</p>
  </> },
  { id: "how-we-use-information", title: "How we use information", body: <>
    <p>Only to: show dashboards, reports, charts and alerts to the business that owns the data and the people it authorized; sync data on a schedule and keep history to show changes over time; generate SEO and marketing insights and recommendations, including with AI (section 5); authenticate users, secure the service, prevent abuse and fix problems; and communicate with you about the service.</p>
    <p>We <strong>do not</strong> sell personal information, use connected account data for advertising, build advertising profiles, share it with data brokers, or use it to train AI models.</p>
  </> },
  { id: "platform-terms", title: "Platform terms and Google Limited Use", body: <>
    <p>We use each platform&apos;s data only as its developer terms allow:</p>
    <PolicyRefs />
    <p><strong>Google:</strong> SEO Insights&apos; use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className={A} target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Google user data is used only to provide the user-facing features described here; it is not used for advertising, is not sold, is not used to train AI models, and is not read by humans unless you give permission, it is necessary for security or to comply with law, or it is aggregated and anonymized for internal operations.</p>
    <p><strong>Meta (Facebook, Instagram, Threads):</strong> Platform Data is not sold, licensed or used for advertising or AI training, and is deleted when you remove SEO Insights or ask Meta to delete it (see <Link href="/data-deletion" className={A}>Data Deletion</Link>).</p>
    <p><strong>TikTok, Pinterest, X, LinkedIn, Microsoft:</strong> data is used only to show the account owner their own statistics, is not sold or shared, and is not used to train AI models.</p>
  </> },
  { id: "ai-generated-insights", title: "AI-generated insights", body: <>
    <p>SEO Insights uses Anthropic&apos;s Claude models to turn analytics and SEO data into plain-language insights and recommendations. We send Anthropic only the data needed for that task: aggregated metrics, search queries, page URLs, titles and text from the business&apos;s public website, social account statistics, and the text of reports you choose to upload. We never send passwords, access tokens or payment details. Under our commercial agreement, Anthropic does not use this data to train its models. AI output can be incomplete or wrong; review recommendations before applying them.</p>
  </> },
  { id: "how-we-share-information", title: "How we share information", body: <>
    <p>Only with service providers that help us run SEO Insights, under contracts limiting their use to providing services to us:</p>
    <ProcessorTable />
    <p>Data from a business&apos;s connected accounts is visible only to that business&apos;s authorized users and the Waheed Zen LLC team members who manage its account. We may disclose information if required by law, to protect rights and safety, or in a merger or acquisition under this policy. We never sell or rent personal information and do not &quot;share&quot; it for cross-context behavioral advertising.</p>
  </> },
  { id: "retention", title: "Retention", body: <>
    <ul>
      <li><strong>Access tokens and API keys</strong> are deleted as soon as an account is disconnected or access is revoked.</li>
      <li><strong>Data received from a connected account</strong> is kept while the account is connected and the workspace is active, to show history. It is deleted within <strong>30 days</strong> (usually immediately) after the account is disconnected, access is revoked, the platform notifies us of removal or a deletion request, or we receive a verified request.</li>
      <li><strong>Workspaces and user accounts</strong> are deleted within <strong>30 days</strong> after closure or a verified request.</li>
      <li><strong>Backups</strong> containing deleted data are overwritten within <strong>{SITE.backupDays} days</strong>; <strong>server logs</strong> are kept up to <strong>{SITE.logDays} days</strong>.</li>
      <li>We keep only a minimal record that a deletion request was received and completed, and anything the law requires.</li>
    </ul>
  </> },
  { id: "security", title: "Security", body: <>
    <p>Data is encrypted in transit (TLS) and at rest. Tokens and keys are stored encrypted and never exposed to the browser. Production access is limited to authorized Waheed Zen LLC personnel using two-factor authentication. No system is perfectly secure; we will notify affected users of a breach as required by law.</p>
  </> },
  { id: "your-rights", title: "Your rights and choices", body: <>
    <ul>
      <li><strong>Disconnect</strong> any account at any time in SEO Insights ({SITE.disconnectPath}).</li>
      <li><strong>Revoke access</strong> on the platform (steps on <Link href="/data-deletion" className={A}>Data Deletion</Link> and <Link href="/platforms" className={A}>Connected platforms</Link>).</li>
      <li><strong>Access, correct, export or delete</strong> your information: email {mail}. We respond within <strong>30 days</strong> (45 days where a state law allows, with notice).</li>
      <li>Depending on where you live (e.g. California and other US states, the EEA, the UK) you may have further rights, such as objecting to processing or complaining to a data protection authority. We will not discriminate against you for exercising them.</li>
    </ul>
    <p>Where EU/UK law applies, we rely on performing our contract with the business you belong to, our legitimate interests in running and securing the service, and consent where required (for example when you connect an account).</p>
  </> },
  { id: "cookies", title: "Cookies", body: <>
    <p>SEO Insights uses only cookies needed to sign you in and keep the app secure (Supabase authentication cookies), plus one functional cookie that remembers the date range you last picked. We do not use advertising cookies or tracking pixels on SEO Insights.</p>
  </> },
  { id: "international-users", title: "International users", body: <p>SEO Insights is operated from the United States; data is processed in the United States and other countries where our providers operate, with safeguards such as Standard Contractual Clauses where required.</p> },
  { id: "children", title: "Children", body: <p>SEO Insights is a business tool, not directed to anyone under 18. We do not knowingly collect children&apos;s information.</p> },
  { id: "changes", title: "Changes", body: <p>We post changes here and update the date above; significant changes are announced to workspace owners by email or in the app.</p> },
  { id: "contact", title: "Contact", body: <p>{SITE.operator} (SEO Insights), {SITE.address} · {mail} · <a href={SITE.phoneHref} className={A}>{SITE.phone}</a></p> },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p>This Privacy Policy explains how <strong>SEO Insights</strong> (&quot;SEO Insights&quot;, &quot;we&quot;, &quot;us&quot;) collects, uses, shares and deletes information. SEO Insights is operated by <strong>Waheed Zen LLC</strong>, a Montana limited liability company, {SITE.address} ({mail}, <a href={SITE.phoneHref} className={A}>{SITE.phone}</a>). Waheed Zen LLC&apos;s agency website has its own policy at <a href={SITE.operatorPrivacy} className={A} target="_blank" rel="noopener noreferrer">{SITE.operatorPrivacy}</a>.</p>}
      sections={sections}
    />
  );
}
