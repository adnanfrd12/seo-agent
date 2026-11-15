import type { Metadata } from "next";
import { BRAND_NAME } from "@/components/brand/brand-mark";
import { ContactLine, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: `Privacy Policy · ${BRAND_NAME}`,
  description: `How ${BRAND_NAME} collects, uses, protects and shares information.`,
};

const sections: LegalSection[] = [
  { id: "who-we-are", title: "Who we are", body: <>
    <p>{BRAND_NAME} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is an SEO and marketing analytics platform. It brings a business&apos;s website, search, local and social performance data together in one dashboard, with reports and recommendations.</p>
    <p>This policy explains what information we collect when you use the {BRAND_NAME} website and dashboard (the &quot;Service&quot;), how we use it, who we share it with and the choices you have. For data that belongs to a client business, we act on behalf of the agency or business that set up the account.</p>
  </> },
  { id: "information-we-collect", title: "Information we collect", body: <>
    <p><strong>Account information.</strong> Your name, email address, profile picture (if you sign in with Google), role and the client workspaces you belong to. Accounts are created by invitation.</p>
    <p><strong>Connected account data.</strong> When an authorised user connects a third-party account, we receive read access to the data that account allows, for example:</p>
    <ul>
      <li>Google Analytics 4 (traffic, engagement and conversion reports), Google Search Console (search queries, clicks, impressions, positions) and Google Business Profile (profile details, performance, reviews and posts);</li>
      <li>Bing Webmaster Tools and Microsoft Clarity (search and behaviour summaries);</li>
      <li>social accounts such as Facebook Pages, Instagram, LinkedIn Pages, Pinterest, YouTube, Threads, X and TikTok (profile details, follower counts, post and audience insights).</li>
    </ul>
    <p><strong>Public and research data.</strong> Public information about websites, search results, keywords, backlinks, business listings, reviews and public social profiles, obtained from data providers or the public web. This includes competitors that a client chooses to track.</p>
    <p><strong>Website content.</strong> Public pages and posts of a client&apos;s own website, read to analyse content and technical SEO.</p>
    <p><strong>Usage and technical data.</strong> Log data such as IP address, browser type, pages viewed, actions taken and error reports, used to run and secure the Service.</p>
    <p><strong>Cookies.</strong> Strictly necessary cookies keep you signed in and remember preferences such as the selected date range. We don&apos;t use advertising cookies or sell browsing data.</p>
  </> },
  { id: "how-we-use", title: "How we use information", body: <>
    <ul>
      <li>To provide the Service: show dashboards, charts and reports, sync connected accounts and keep history for trend analysis;</li>
      <li>to generate insights, summaries and recommendations, including with AI models processing the client&apos;s analytics data;</li>
      <li>to authenticate users, manage access and protect against fraud, abuse and security incidents;</li>
      <li>to send service messages such as sign-in links, alerts and reports you&apos;ve asked for;</li>
      <li>to maintain, troubleshoot and improve the Service;</li>
      <li>to comply with legal obligations.</li>
    </ul>
    <p>We don&apos;t sell personal information, and we don&apos;t use connected account data for advertising.</p>
  </> },
  { id: "google-limited-use", title: "Google API services and connected platforms", body: <>
    <p>{BRAND_NAME}&apos;s use and transfer of information received from Google APIs follows the <a className="text-[#E8552A] underline-offset-2 hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Google user data is used only to provide and improve the user-facing features of the Service, is not transferred to others except as needed to provide those features, to comply with law or as part of a merger or acquisition, is not used for advertising, and is not read by people unless you consent, it&apos;s needed for security, or the law requires it.</p>
    <p>Social accounts are connected through each platform&apos;s official sign-in (OAuth), in some cases through our integration partner Composio. We request read-only access to profile and insights data and never post on your behalf. Data received from each platform is handled under that platform&apos;s developer terms as well as this policy.</p>
    <p>You can disconnect an account at any time from the dashboard, and you can also revoke access in the platform&apos;s own security settings (for example, your Google Account&apos;s third-party access page).</p>
  </> },
  { id: "sharing", title: "How we share information", body: <>
    <p>We share information only as needed to run the Service, with service providers bound by confidentiality and data-protection obligations:</p>
    <ul>
      <li>hosting, database and authentication (for example Vercel and Supabase);</li>
      <li>integration and connection management (Composio);</li>
      <li>SEO and market data providers (for example DataForSEO), which receive search terms, domains and business names, not your personal account data;</li>
      <li>AI processing (Anthropic), which analyses report data to produce insights and doesn&apos;t use it to train its models under our commercial terms;</li>
      <li>email delivery for alerts and reports.</li>
    </ul>
    <p>Within a client workspace, its owners, admins and invited members can see that workspace&apos;s data. We may also disclose information if the law requires it, to protect rights and safety, or as part of a merger, acquisition or sale of assets, subject to this policy.</p>
  </> },
  { id: "retention", title: "Data retention", body: <>
    <p>We keep account and analytics data while the workspace is active, so trends and comparisons stay available. Connection tokens are deleted when an account is disconnected. When a workspace is closed, or on a verified request, we delete or anonymise its data within a reasonable period, except where the law requires us to keep it. Backups expire on a rolling schedule.</p>
  </> },
  { id: "security", title: "Security", body: <>
    <p>We protect information with encryption in transit (HTTPS), encryption of stored access tokens, role-based access control, row-level security in the database and limited staff access. No system is completely secure, but we work to protect your information and will notify affected users of a breach where the law requires it.</p>
  </> },
  { id: "your-rights", title: "Your rights and choices", body: <>
    <p>Depending on where you live (including under the GDPR, UK GDPR and California privacy laws), you may have the right to access, correct, delete or export your personal information, and to object to or restrict certain processing. You can:</p>
    <ul>
      <li>update your profile, and disconnect integrations, from within the dashboard;</li>
      <li>ask us to access, correct, export or delete your data by contacting us (see below);</li>
      <li>complain to your local data-protection authority.</li>
    </ul>
    <p>Where we process client data on behalf of an agency or business, we&apos;ll pass your request to them or help them respond.</p>
  </> },
  { id: "international", title: "International transfers", body: <>
    <p>Our service providers may process information in countries other than yours, including the United States. Where required, we rely on appropriate safeguards such as standard contractual clauses.</p>
  </> },
  { id: "children", title: "Children", body: <p>The Service is for businesses and isn&apos;t directed at children under 16. We don&apos;t knowingly collect their personal information.</p> },
  { id: "changes", title: "Changes to this policy", body: <p>We may update this policy as the Service changes. We&apos;ll post the new version here with a new &quot;Last updated&quot; date and, for significant changes, notify account owners.</p> },
  { id: "contact", title: "Contact us", body: <p>For privacy questions or requests, contact us at <ContactLine subject="Privacy request" />.</p> },
];

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" sections={sections} other={{ href: "/terms", label: "Terms and Conditions" }}
      intro={<p>Your trust matters to us. This policy describes how {BRAND_NAME} handles information about you and the businesses we serve. By using the Service, you acknowledge the practices described here.</p>} />
  );
}
