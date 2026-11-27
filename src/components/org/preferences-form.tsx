"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePreferences } from "@/app/(dashboard)/settings/organization/actions";
import { DATE_RANGES, WEEK_STARTS } from "./labels";
import { Section } from "./section";
import { hint, input, label } from "./styles";
import { SaveBar, useUnsavedWarning, type ActionResult } from "./ui";

export interface PreferenceValues { defaultRangeDays: number; weekStart: string }

/** Settings → Organization → Preferences (organizations.preferences). */
export function PreferencesForm({ orgId, initial, canEdit }: { orgId: string; initial: PreferenceValues; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [v, setV] = useState(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  useUnsavedWarning(dirty && canEdit);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await savePreferences(orgId, v);
        setResult(r);
        if (r.ok) { setSaved(v); router.refresh(); }
      });
    }}>
      <Section title="Preferences" description={canEdit ? "Organization-wide defaults. Each client can still change its own date range." : "Only owners and admins can change these."}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>Default date range for new clients
            <select value={v.defaultRangeDays} disabled={!canEdit} onChange={(e) => { setV({ ...v, defaultRangeDays: Number(e.target.value) }); setResult(null); }} className={input}>
              {DATE_RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
            <span className={hint}>Applied when a client is created. Existing clients keep theirs.</span>
          </label>
          <label className={label}>Week starts on
            <select value={v.weekStart} disabled={!canEdit} onChange={(e) => { setV({ ...v, weekStart: e.target.value }); setResult(null); }} className={input}>
              {WEEK_STARTS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <span className={hint}>For weekly views and reports.</span>
          </label>
        </div>
        {canEdit && <div className="mt-6"><SaveBar dirty={dirty} pending={pending} result={result} onDiscard={() => { setV(saved); setResult(null); }} /></div>}
      </Section>
    </form>
  );
}
