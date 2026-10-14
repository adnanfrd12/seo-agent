"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { createAndSwitchClient, setActiveClient } from "@/app/(dashboard)/client-actions";
import { cn } from "@/lib/utils";

interface Item { id: string; name: string; role: string }

/** Header client picker: switch between clients you belong to, or create a new one. */
export function ClientSwitcher({ clients, activeId, lastSyncedAt }: {
  clients: Item[]; activeId: string; lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const active = clients.find((c) => c.id === activeId) ?? clients[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setOpen(false); setCreating(false); setName("");
      // land on the overview: query params (property/site/filters) belong to the old client
      router.push("/overview");
      router.refresh();
    });

  return (
    <div ref={root} className="relative min-w-0">
      <button
        onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} aria-label="Switch client"
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" aria-hidden />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{active?.name}</span>
          <span className="block truncate text-xs text-muted">
            {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : "Not synced yet"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Clients</p>
          <ul role="listbox" aria-label="Clients" className="max-h-72 overflow-y-auto p-1">
            {clients.map((c) => (
              <li key={c.id}>
                <button
                  role="option" aria-selected={c.id === active?.id} disabled={pending}
                  onClick={() => (c.id === active?.id ? setOpen(false) : run(() => setActiveClient(c.id)))}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-muted",
                    c.id === active?.id && "font-semibold")}
                >
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs capitalize text-muted">{c.role}</span>
                  {c.id === active?.id && <Check className="size-4 text-accent" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-2">
            {creating ? (
              <form onSubmit={(e) => { e.preventDefault(); run(() => createAndSwitchClient(name)); }} className="space-y-2">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Client name"
                  aria-label="New client name"
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                <div className="flex gap-2">
                  <button disabled={pending} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">Create</button>
                  <button type="button" onClick={() => setCreating(false)} className="rounded-lg px-3 py-1.5 text-sm hover:bg-surface-muted">Cancel</button>
                </div>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-accent hover:bg-surface-muted">
                <Plus className="size-4" aria-hidden /> New client
              </button>
            )}
            {error && <p role="alert" className="px-1 pt-2 text-xs text-negative">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
