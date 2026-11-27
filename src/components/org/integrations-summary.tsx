import "server-only";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listCredentials } from "@/lib/org/credentials";
import { CATEGORIES, INTEGRATIONS } from "@/lib/org/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { btn, pill } from "./styles";

/**
 * Settings → Organization → Integrations: which integrations this organization has set up, with a link to the
 * Integrations page where they're managed. Only whether a value is set is read here, never the value or its hint.
 */
const PER_CLIENT: Record<string, string> = { ga4: "ga4", gsc: "gsc", clarity: "clarity" };

export async function IntegrationsSummary({ orgId, canManageCredentials, connected, clientCount }: {
  orgId: string; canManageCredentials: boolean; connected: Record<string, number>; clientCount: number;
}) {
  const creds = await listCredentials(createAdminClient(), orgId);
  const set = new Map(creds.map((c) => [c.key, c.source]));
  const status = (id: string): { text: string; tone: string } => {
    const def = INTEGRATIONS.find((i) => i.id === id)!;
    if (def.perClient) {
      const n = connected[PER_CLIENT[id] ?? id] ?? 0;
      return { text: `${n} of ${clientCount} clients`, tone: n ? "bg-positive-soft text-positive" : "bg-surface-muted text-secondary" };
    }
    if (id === "custom") {
      const n = creds.filter((c) => c.integration === "custom").length;
      return { text: n ? `${n} set` : "None", tone: "bg-surface-muted text-secondary" };
    }
    const req = def.fields.filter((f) => f.required);
    const have = def.fields.filter((f) => set.get(f.key));
    const env = have.some((f) => set.get(f.key) === "env");
    if (req.length ? req.every((f) => set.get(f.key)) : have.length > 0) return { text: env ? "Set up (server)" : "Set up", tone: "bg-positive-soft text-positive" };
    if (have.length) return { text: "Partly set up", tone: "bg-warn-soft text-warn" };
    return { text: req.length ? "Not set up" : "Optional", tone: "bg-surface-muted text-secondary" };
  };

  return (
    <Section title="Integrations" description={canManageCredentials ? "Owners add and change credentials on the Integrations page. Values are encrypted and never shown again." : "Only owners can add or change credentials. Ask an owner if something isn't set up."}
      action={<Link href="/integrations" className={btn.primary}>Open Integrations <ArrowRight className="size-4" aria-hidden /></Link>}>
      <div className="grid gap-6 md:grid-cols-2">
        {CATEGORIES.map((cat) => {
          const items = INTEGRATIONS.filter((i) => i.category === cat.id);
          if (!items.length) return null;
          return (
            <div key={cat.id}>
              <h3 className="text-xs font-medium text-faint">{cat.label}</h3>
              <ul className="mt-2 divide-y divide-hairline rounded-lg border border-border">
                {items.map((i) => {
                  const s = status(i.id);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate text-sm" title={i.description}>{i.name}</span>
                      <span className={cn(pill, "shrink-0", s.tone)}>{s.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">Google Analytics, Search Console and Clarity connect per client; the counts show how many active clients are connected.</p>
    </Section>
  );
}
