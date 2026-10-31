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
      <div role="tablist" aria-label={label} className="mb-4 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-surface-muted p-[3px]">
        {items.map((i) => (
          <button key={i.key} id={`${id}-${i.key}`} role="tab" aria-selected={i.key === cur.key} aria-controls={`${id}-panel`} onClick={() => { setActive(i.key); onChange?.(i.key); }}
            className={cn("h-7 rounded-md px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              i.key === cur.key ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-secondary hover:text-foreground")}>
            {i.label}{i.badge != null && <span className="ml-1.5 tabular-nums text-muted">{i.badge}</span>}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${cur.key}`}>{cur.content}</div>
    </div>
  );
}
