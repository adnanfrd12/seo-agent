"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ServerCog } from "lucide-react";
import { ConfirmDialog } from "@/components/dashboard/dialog";
import { importServerEnvironment } from "@/app/(dashboard)/integrations/credential-actions";
import { btnPrimary } from "./credential-card";

/**
 * Owners of the first organization: it still reads credentials it hasn't stored from the hosting environment.
 * "Import" copies those values into the organization (encrypted) and turns the fallback off, so everything is
 * managed here from then on. The hosting environment itself is not changed. Only key names are shown.
 */
export function ImportEnvBanner({ orgId, envKeys }: { orgId: string; envKeys: string[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imported: string[]; skipped: string[] } | null>(null);
  const [pending, start] = useTransition();
  const n = envKeys.length;

  const run = () => start(async () => {
    setError(null);
    try {
      const r = await importServerEnvironment(orgId);
      if (!r.ok) { setError(r.error); return; }
      setConfirm(false);
      setDone({ imported: r.imported, skipped: r.skipped });
      router.refresh();
    } catch {
      setError("Couldn't import. Check your connection and try again.");
    }
  });

  if (done) {
    return (
      <div role="status" className="mb-4 rounded-[10px] border border-positive/30 bg-positive-soft p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-positive"><CheckCircle2 className="size-4" aria-hidden /> Imported {done.imported.length} {done.imported.length === 1 ? "value" : "values"}. This organization now uses only its own credentials.</p>
        {done.imported.length > 0 && <p className="mt-2 break-words font-mono text-xs text-secondary">{done.imported.join(", ")}</p>}
        {done.skipped.length > 0 && <p className="mt-2 text-xs text-secondary">Kept the values already saved here for {done.skipped.join(", ")}.</p>}
        <p className="mt-2 text-xs text-secondary">The hosting environment wasn&apos;t changed. Once everything works, the platform admin can remove these variables there.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="import-env-title" className="mb-4 rounded-[10px] border border-warn/30 bg-warn-soft p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-warn"><ServerCog className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 text-sm">
          <h3 id="import-env-title" className="font-semibold text-foreground">Move the server&apos;s credentials into this organization</h3>
          <p className="mt-1 leading-relaxed text-secondary">
            {n > 0 ? `${n} ${n === 1 ? "value this organization uses is" : "values this organization uses are"}` : "Values this organization hasn't saved are"} still read from the hosting environment.
            Importing copies them here, encrypted, and stops the fallback, so every credential is managed on this page. Nothing in the hosting environment is changed.
          </p>
          {n > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium text-foreground">Show the {n} {n === 1 ? "name" : "names"}</summary>
              <p className="mt-1.5 break-words font-mono text-secondary">{envKeys.join(", ")}</p>
            </details>
          )}
        </div>
        <button type="button" className={btnPrimary} onClick={() => { setError(null); setConfirm(true); }} disabled={pending}>
          Import {n > 0 ? `${n} ${n === 1 ? "value" : "values"}` : "values"}
        </button>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={run} busy={pending} error={error} tone="primary"
        title="Import the server's credentials?" confirmLabel={pending ? "Importing…" : "Import"}
        icon={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-warn-soft text-warn"><ServerCog className="size-5" aria-hidden /></span>}>
        <p>
          {n > 0 ? `${n} ${n === 1 ? "value is" : "values are"}` : "The values the server has are"} copied into this organization and encrypted. Values already saved here are kept.
          After that, this organization stops reading the hosting environment: anything it hasn&apos;t saved shows as not configured.
        </p>
        <p className="mt-2">The fallback can&apos;t be turned back on from the app.</p>
      </ConfirmDialog>
    </section>
  );
}
