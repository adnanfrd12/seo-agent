"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type L = { brand: string[]; competitors: string[]; cities: string[]; services: string[] };
/** The lists behind the brand, competitor, city and service segments (one per line). */
export function GscSettingsForm({ initial, sources, action, disabled }: { initial: L; sources: Record<keyof L, string>; disabled?: boolean; action: (x: Record<keyof L, string>) => Promise<{ ok: boolean; message: string }> }) {
  const router = useRouter();
  const [v, setV] = useState<Record<keyof L, string>>({ brand: initial.brand.join("\n"), competitors: initial.competitors.join("\n"), cities: initial.cities.join("\n"), services: initial.services.join("\n") });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const field = (k: keyof L, label: string, hint: string) => (
    <label className="text-xs font-medium text-muted">{label} <span className="font-normal text-faint">· {sources[k]}</span>
      <textarea rows={5} value={v[k]} disabled={disabled} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder={hint} className="mt-1 w-full rounded-md border border-border bg-surface p-2 font-mono text-xs text-foreground" />
    </label>
  );
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {field("brand", "Brand terms", "business name, misspellings, domain, owner's name")}
        {field("competitors", "Competitors", "competitor business names")}
        {field("cities", "Cities and areas served", "one town per line")}
        {field("services", "Services", "one service per line, e.g. channel letters")}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || pending} onClick={() => start(async () => { const r = await action(v); setMsg(r.message); router.refresh(); })} className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-60">{pending ? "Saving…" : "Save lists"}</button>
        {msg && <span role="status" className="text-xs text-positive">{msg}</span>}
      </div>
    </div>
  );
}
