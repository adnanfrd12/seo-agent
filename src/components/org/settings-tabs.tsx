"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** The top of Settings: your own account, your organization and (platform administrators) the platform. */
export function SettingsTabs({ items }: { items: { href: string; label: string; match: string }[] }) {
  const pathname = usePathname();
  const active = [...items].sort((a, b) => b.match.length - a.match.length).find((i) => pathname === i.match || pathname.startsWith(`${i.match}/`));
  return (
    <nav aria-label="Settings" className="mb-6 border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((i) => {
          const on = active?.href === i.href;
          return (
            <li key={i.href} className="shrink-0">
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={cn("inline-flex h-10 items-center border-b-2 px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  on ? "border-accent font-medium text-foreground" : "border-transparent text-secondary hover:text-foreground")}>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
