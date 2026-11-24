import Link from "next/link";
import { PROCESSORS, publicPlatforms, type PlatformEntry } from "@/config/platforms";
import { A } from "./legal-page";

/** Blocks generated from the platform registry (src/config/platforms.ts). Only `live` and `in_review` entries appear. */

const slug = (p: PlatformEntry) => `platform-${p.id.replace(/_/g, "-")}`;
const METHOD: Record<PlatformEntry["connection"], string> = { composio: "OAuth through Composio", oauth: "OAuth", api_key: "API key or token" };

export function ScopeTable({ p }: { p: PlatformEntry }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
        <caption className="sr-only">{p.name} permissions</caption>
        <thead>
          <tr className="border-b border-[#EEE9E4] text-[#5a5a63]"><th scope="col" className="py-1.5 pr-3 font-semibold">Permission</th><th scope="col" className="py-1.5 font-semibold">Why we need it</th></tr>
        </thead>
        <tbody>
          {p.scopes.map((s) => (
            <tr key={s.scope} className="border-b border-[#F5F1ED] align-top">
              <td className="py-1.5 pr-3"><code className="break-all text-[13px] text-[#1f1f25]">{s.scope}</code></td>
              <td className="py-1.5">{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Privacy Policy section 2: one sub-section per platform. */
export function PrivacyPlatforms() {
  return (
    <>
      {publicPlatforms().map((p) => (
        <div key={p.id} id={slug(p)} className="scroll-mt-8">
          <h3>{p.name} ({p.provider})</h3>
          <p><strong>Data we access:</strong> {p.dataAccessed.join("; ")}.</p>
          <p><strong>Why:</strong> {p.purpose}</p>
          <h4>Permissions requested</h4>
          <ul>{p.scopes.map((s) => <li key={s.scope}><code className="break-all text-[13px]">{s.scope}</code>: {s.reason}</li>)}</ul>
          <p><strong>How to disconnect:</strong> {p.revokeSteps.join(" ")} See <Link href="/data-deletion" className={A}>Data Deletion</Link>.</p>
        </div>
      ))}
      <p>The full list is on <Link href="/platforms" className={A}>Connected platforms and permissions</Link>.</p>
    </>
  );
}

/** Privacy Policy section 4: developer terms per provider. */
export function PolicyRefs() {
  const seen = new Map<string, { label: string; url: string }>();
  for (const p of publicPlatforms()) for (const r of p.policyRefs) seen.set(r.url, r);
  return <ul>{[...seen.values()].map((r) => <li key={r.url}><a href={r.url} className={A} target="_blank" rel="noopener noreferrer">{r.label}</a></li>)}</ul>;
}

/** Privacy Policy section 6: service providers. */
export function ProcessorTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <caption className="sr-only">Service providers</caption>
        <thead><tr className="border-b border-[#EEE9E4] text-[#5a5a63]"><th scope="col" className="py-1.5 pr-3 font-semibold">Provider</th><th scope="col" className="py-1.5 pr-3 font-semibold">Purpose</th><th scope="col" className="py-1.5 font-semibold">Data involved</th></tr></thead>
        <tbody>
          {PROCESSORS.map((p) => (
            <tr key={p.name} className="border-b border-[#F5F1ED] align-top">
              <td className="py-1.5 pr-3 font-medium text-[#1f1f25]"><a href={p.url} className="hover:underline" target="_blank" rel="noopener noreferrer">{p.name}</a></td>
              <td className="py-1.5 pr-3">{p.purpose}</td>
              <td className="py-1.5">{p.data}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data Deletion option 2: how to remove SEO Insights on each platform. */
export function RevokeList() {
  return (
    <>
      {publicPlatforms().map((p) => (
        <div key={p.id} id={`remove-${p.id.replace(/_/g, "-")}`} className="scroll-mt-8">
          <h3>{p.name}</h3>
          <ul>{p.revokeSteps.map((s) => <li key={s}>{s}</li>)}</ul>
          {p.revokeUrl && <p><a href={p.revokeUrl} className={A} target="_blank" rel="noopener noreferrer">Open {p.provider} settings</a></p>}
        </div>
      ))}
    </>
  );
}

/** /platforms: one card per platform. */
export function PlatformCard({ p }: { p: PlatformEntry }) {
  return (
    <section id={slug(p)} aria-labelledby={`${slug(p)}-h`} className="grid scroll-mt-28 gap-6 border-t border-[#17120E]/12 py-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
      <div>
        <h2 id={`${slug(p)}-h`} className="font-[family-name:var(--font-public-serif)] text-[2rem] font-normal leading-tight tracking-[-0.01em] text-[#17120E]">{p.name}</h2>
        <p className="mt-1 text-[15px] text-[#6B635C]">{p.provider}</p>
        <span className="mt-4 inline-block rounded-full border border-[#E8452C]/25 px-3 py-1 text-xs font-semibold text-[#9A3412]">Read-only · {METHOD[p.connection]}</span>
      </div>
      <div className="max-w-[760px] space-y-4 text-[17px] leading-[1.7] text-[#3A332D]">
        <p><strong className="text-[#1f1f25]">Connection:</strong> {p.method}</p>
        <div><strong className="text-[#1f1f25]">Data we access</strong><ul className="list-disc pl-5">{p.dataAccessed.map((d) => <li key={d}>{d}</li>)}</ul></div>
        <p><strong className="text-[#1f1f25]">Why:</strong> {p.purpose}</p>
        <ScopeTable p={p} />
        <div><strong className="text-[#1f1f25]">How to disconnect</strong>
          <ul className="list-disc pl-5"><li>In SEO Insights: press Disconnect on the {p.socialKey ? "Social media" : "Integrations"} page. Data received from the account is deleted.</li>{p.revokeSteps.map((s) => <li key={s}>{s}{p.revokeUrl && <> (<a href={p.revokeUrl} className={A} target="_blank" rel="noopener noreferrer">open settings</a>)</>}</li>)}</ul>
        </div>
        <p className="text-sm"><strong className="text-[#1f1f25]">Developer terms:</strong> {p.policyRefs.map((r, i) => <span key={r.url}>{i ? " · " : ""}<a href={r.url} className={A} target="_blank" rel="noopener noreferrer">{r.label}</a></span>)}</p>
      </div>
    </section>
  );
}
