import type { Metadata } from "next";
import Link from "next/link";
import { BRAND_NAME } from "@/components/brand/brand-mark";
import { ContactLine, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: `Terms and Conditions · ${BRAND_NAME}`,
  description: `The terms that govern use of ${BRAND_NAME}.`,
};

const sections: LegalSection[] = [
  { id: "acceptance", title: "Acceptance of these terms", body: <>
    <p>These Terms and Conditions (&quot;Terms&quot;) govern your access to and use of {BRAND_NAME} (the &quot;Service&quot;). By signing in or using the Service, you agree to these Terms and to our <Link href="/privacy" className="text-[#E8552A] underline-offset-2 hover:underline">Privacy Policy</Link>. If you use the Service on behalf of a business, you confirm that you are authorised to accept these Terms for it.</p>
  </> },
  { id: "service", title: "The Service", body: <>
    <p>{BRAND_NAME} provides analytics dashboards, reports, research data and recommendations about websites, search, local listings, reviews and social media. Features may change as we improve the Service, and some features depend on third-party platforms and data providers.</p>
  </> },
  { id: "accounts", title: "Accounts and access", body: <>
    <ul>
      <li>Accounts are created by invitation. You must give accurate information and keep your sign-in details secure.</li>
      <li>You are responsible for activity under your account. Tell us promptly about any unauthorised use.</li>
      <li>Workspace owners and admins decide who has access to their workspace and what role each member has.</li>
    </ul>
  </> },
  { id: "connected-accounts", title: "Connected accounts and third-party services", body: <>
    <p>You may connect accounts such as Google Analytics, Search Console, Business Profile, Bing Webmaster Tools, Microsoft Clarity and social media platforms. By connecting an account, you confirm that you are authorised to do so and you allow us to access the data that the account permits, as described in the Privacy Policy.</p>
    <p>Third-party services are governed by their own terms. We aren&apos;t responsible for their availability, changes to their APIs, limits, permissions or the accuracy of the data they provide. You can disconnect any account at any time.</p>
  </> },
  { id: "your-data", title: "Your data", body: <>
    <p>You and the businesses you represent keep all rights in your data. You grant us a limited licence to host, process, analyse and display that data only to provide and improve the Service for you. You are responsible for having the rights and consents needed for any data you provide or connect.</p>
  </> },
  { id: "acceptable-use", title: "Acceptable use", body: <>
    <p>You agree not to:</p>
    <ul>
      <li>use the Service unlawfully, or in violation of the terms of any connected platform;</li>
      <li>connect accounts or monitor websites that you aren&apos;t authorised to manage;</li>
      <li>try to gain unauthorised access, probe or disrupt the Service, or get around its security or usage limits;</li>
      <li>scrape, copy or resell the Service or its data, except reports exported for your own business use;</li>
      <li>upload malicious code or use the Service to send spam or harmful content.</li>
    </ul>
  </> },
  { id: "insights", title: "Insights, AI and data accuracy", body: <>
    <p>Reports may include figures from third-party data providers and recommendations generated with the help of AI. They are provided for information. Data can be delayed, sampled, incomplete or estimated by its source, and search rankings and platform algorithms change. Review recommendations before acting on them. We don&apos;t guarantee any particular ranking, traffic or business result.</p>
  </> },
  { id: "fees", title: "Fees", body: <p>Fees, if any, are set out in your order, proposal or agreement with us. Unless that agreement says otherwise, fees are non-refundable and exclude taxes. We may suspend access for overdue amounts after giving notice.</p> },
  { id: "ip", title: "Intellectual property", body: <p>The Service, including its software, design, text and branding, belongs to {BRAND_NAME} and its licensors and is protected by law. We grant you a limited, non-exclusive, non-transferable right to use the Service under these Terms. Feedback you share may be used to improve the Service without obligation to you.</p> },
  { id: "availability", title: "Availability and changes", body: <p>We aim to keep the Service available and reliable but don&apos;t guarantee uninterrupted or error-free operation. We may carry out maintenance, and we may modify or discontinue features, giving reasonable notice of material changes where we can.</p> },
  { id: "termination", title: "Suspension and termination", body: <p>You may stop using the Service at any time. We may suspend or end access if you breach these Terms, if required by law, or to protect the Service or other users. After termination, your right to use the Service ends. We handle remaining data as described in the Privacy Policy.</p> },
  { id: "disclaimers", title: "Disclaimers", body: <p>To the extent permitted by law, the Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, including merchantability, fitness for a particular purpose and non-infringement.</p> },
  { id: "liability", title: "Limitation of liability", body: <p>To the extent permitted by law, {BRAND_NAME} won&apos;t be liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill. Our total liability for any claim relating to the Service is limited to the amount you paid us for the Service in the twelve months before the claim. Nothing in these Terms limits liability that can&apos;t be limited by law.</p> },
  { id: "indemnity", title: "Indemnity", body: <p>You agree to indemnify {BRAND_NAME} against claims, losses and expenses arising from your misuse of the Service, your breach of these Terms, or data you connect or provide without the necessary rights.</p> },
  { id: "general", title: "General", body: <>
    <p>These Terms, together with any order or agreement with us, are the entire agreement about the Service. If a provision is unenforceable, the rest stays in effect. A failure to enforce a right isn&apos;t a waiver. You may not transfer these Terms without our consent. These Terms are governed by the laws that apply to {BRAND_NAME}&apos;s operating entity, unless your agreement with us specifies otherwise.</p>
    <p>We may update these Terms. We&apos;ll post the new version here with a new &quot;Last updated&quot; date. If you keep using the Service after changes take effect, you accept them.</p>
  </> },
  { id: "contact", title: "Contact", body: <p>Questions about these Terms? Contact us at <ContactLine subject="Terms question" />.</p> },
];

export default function TermsPage() {
  return (
    <LegalPage title="Terms and Conditions" sections={sections} other={{ href: "/privacy", label: "Privacy Policy" }}
      intro={<p>Please read these Terms carefully. They explain your rights and responsibilities when you use {BRAND_NAME}.</p>} />
  );
}
