"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/** Simple tab switcher for already-rendered sections (nothing is fetched when switching). */
export function Tabs({ items, label, onChange }: {
  items: { key: string; label: string; badge?: string | number; content: React.ReactNode }[]; label: string; onChange?: (key: string) => void;
}) {
  const [active, setActive] = useState(items[0]?.key);
  const id = useId();
  const cur = items.find((i) => i.key === active) ?? items[0];
  if (!cur) return null;
  return (
    <div>
      <div role="tablist" aria-label={label} className="mb-3 inline-flex max-w-full flex-wrap rounded-lg border border-border p-0.5">
        {items.map((i) => (
          <button key={i.key} id={`${id}-${i.key}`} role="tab" aria-selected={i.key === cur.key} aria-controls={`${id}-panel`} onClick={() => { setActive(i.key); onChange?.(i.key); }}
            className={cn("rounded-md px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              i.key === cur.key ? "bg-accent text-accent-foreground shadow-sm" : "text-foreground/80 hover:bg-surface-muted")}>
            {i.label}{i.badge != null && <span className="ml-1.5 opacity-70">{i.badge}</span>}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${cur.key}`}>{cur.content}</div>
    </div>
  );
}
