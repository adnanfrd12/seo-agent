import { TabHeader } from "@/components/dashboard/tab-header";
import { SecurityAuditSection } from "@/components/security/security-audit";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { loadSecurity } from "@/lib/technical/security";

export const maxDuration = 300; // the audit (passive checks) and Claude's review run in the Run security audit action

export default async function SecurityAuditPage() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const sec = await loadSecurity(await createClient(), client.id).catch(() => ({ audit: null, ai: null }));
  return (
    <>
      <TabHeader source={null} eyebrow="SEO Research" title="Security Audit"
        description="Website security: HTTPS, headers, exposed files, WordPress, email DNS, casino / porn / pharma spam injection and cloaking, audited by Claude."
        guide={[
          { term: "Automated checks", text: "Passive checks a browser could make (normal page requests, one TLS handshake, DNS lookups, the home page as Googlebot). Nothing is attacked or stress-tested. Re-checked monthly." },
          { term: "Claude security audit", text: "Claude reviews every check plus the raw evidence of the home page (headers, scripts and plugin versions, third-party hosts, forms, inline scripts) and writes the overall risk, findings with evidence and the exact fixes, in order." },
          { term: "Spam & hacks", text: "Casino, adult and pharma wording and links, links hidden with CSS, content shown only to Google (cloaking), spam pages in the sitemap and obfuscated scripts: the usual signs of a hacked site." },
          { term: "Score", text: "100 minus 25 / 6 / 2 per failed high / medium / low issue, half for a warning." },
          { term: "Details", text: "Click any failed check for the full result and Claude's explanation and fix." },
        ]} />
      <SecurityAuditSection audit={sec.audit} ai={sec.ai} canEdit={canEdit} />
    </>
  );
}
