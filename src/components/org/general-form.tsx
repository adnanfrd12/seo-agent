"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGeneral } from "@/app/(dashboard)/settings/organization/actions";
import { CURRENCIES, LANGUAGES } from "./labels";
import { Section } from "./section";
import { hint, input, label } from "./styles";
import { SaveBar, useUnsavedWarning, type ActionResult } from "./ui";

export interface GeneralValues {
  name: string; description: string; website: string; email: string; phone: string;
  address: { line1: string; line2: string; city: string; region: string; postal_code: string; country: string };
  timezone: string; language: string; currency: string;
}

/** Settings → Organization → General: the organization's details and defaults. Owners and admins edit. */
export function GeneralForm({ orgId, initial, canEdit, timezones }: { orgId: string; initial: GeneralValues; canEdit: boolean; timezones: string[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [v, setV] = useState(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  useUnsavedWarning(dirty && canEdit);

  const set = <K extends keyof GeneralValues>(k: K, val: GeneralValues[K]) => { setV((x) => ({ ...x, [k]: val })); setResult(null); };
  const setAddr = (k: keyof GeneralValues["address"], val: string) => set("address", { ...v.address, [k]: val });
  const zones = timezones.includes(v.timezone) ? timezones : [v.timezone, ...timezones];
  const ro = !canEdit;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveGeneral(orgId, v as Parameters<typeof saveGeneral>[1]); // validated on the server
          setResult(r);
          if (r.ok) {
            // keep what the server stored (e.g. https:// added to the website)
            const next = { ...v, website: v.website && !/^https?:\/\//i.test(v.website) ? `https://${v.website}` : v.website };
            setV(next); setSaved(next); router.refresh();
          }
        });
      }}
      className="space-y-6"
    >
      <Section title="Organization details" description={canEdit ? "Shown to your team, on invitations and in reports." : "Only owners and admins can change these."}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Organization name
            <input value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} disabled={ro} className={input} autoComplete="organization" />
          </label>
          <label className={`${label} sm:col-span-2`}>Description <span className="font-normal text-muted">(optional)</span>
            <textarea value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} rows={3} disabled={ro} className={`${input} resize-y`} />
          </label>
          <label className={label}>Website
            <input value={v.website} onChange={(e) => set("website", e.target.value)} maxLength={300} disabled={ro} inputMode="url" placeholder="https://example.com" className={input} autoComplete="url" />
          </label>
          <label className={label}>Business email
            <input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} maxLength={200} disabled={ro} placeholder="hello@example.com" className={input} autoComplete="email" />
          </label>
          <label className={label}>Phone
            <input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} maxLength={60} disabled={ro} placeholder="+1 555 123 4567" className={input} autoComplete="tel" />
          </label>
        </div>
      </Section>

      <Section title="Address" description="Optional. Used where your contact details appear, such as branded reports.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Street address
            <input value={v.address.line1} onChange={(e) => setAddr("line1", e.target.value)} maxLength={160} disabled={ro} className={input} autoComplete="address-line1" />
          </label>
          <label className={`${label} sm:col-span-2`}>Apartment, suite, etc.
            <input value={v.address.line2} onChange={(e) => setAddr("line2", e.target.value)} maxLength={160} disabled={ro} className={input} autoComplete="address-line2" />
          </label>
          <label className={label}>City
            <input value={v.address.city} onChange={(e) => setAddr("city", e.target.value)} maxLength={120} disabled={ro} className={input} autoComplete="address-level2" />
          </label>
          <label className={label}>State / region
            <input value={v.address.region} onChange={(e) => setAddr("region", e.target.value)} maxLength={120} disabled={ro} className={input} autoComplete="address-level1" />
          </label>
          <label className={label}>Postal code
            <input value={v.address.postal_code} onChange={(e) => setAddr("postal_code", e.target.value)} maxLength={30} disabled={ro} className={input} autoComplete="postal-code" />
          </label>
          <label className={label}>Country
            <input value={v.address.country} onChange={(e) => setAddr("country", e.target.value)} maxLength={120} disabled={ro} className={input} autoComplete="country-name" />
          </label>
        </div>
      </Section>

      <Section title="Defaults" description="Used for new clients and wherever the organization's own settings apply.">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={label}>Default time zone
            <select value={v.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={ro} className={input}>
              {zones.map((tz) => <option key={tz}>{tz}</option>)}
            </select>
            <span className={hint}>New clients start with it.</span>
          </label>
          <label className={label}>Language
            <select value={v.language} onChange={(e) => set("language", e.target.value)} disabled={ro} className={input}>
              {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label className={label}>Currency
            <select value={v.currency} onChange={(e) => set("currency", e.target.value)} disabled={ro} className={input}>
              {(CURRENCIES as readonly string[]).includes(v.currency) ? null : <option value={v.currency}>{v.currency}</option>}
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {canEdit && <div className="mt-6"><SaveBar dirty={dirty} pending={pending} result={result} onDiscard={() => { setV(saved); setResult(null); }} /></div>}
      </Section>
    </form>
  );
}
