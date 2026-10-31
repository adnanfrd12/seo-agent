"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { Avatar } from "./avatar";

/** Avatar button with a dropdown: identity, Settings, Sign out. Closes on outside click and Escape. */
export function UserMenu({
  name, email, avatarUrl, signOut,
}: { name: string | null; email: string; avatarUrl: string | null; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu" aria-expanded={open} aria-label="Account menu"
        className="rounded-full outline-none ring-offset-2 ring-offset-surface transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Avatar src={avatarUrl} name={name} email={email} size={36} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-[10px] border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-3 border-b border-border p-3">
            <Avatar src={avatarUrl} name={name} email={email} size={40} />
            <div className="min-w-0">
              {name && <p className="truncate text-sm font-semibold">{name}</p>}
              <p className="truncate text-xs text-muted">{email}</p>
            </div>
          </div>
          <div className="p-1">
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted">
              <Settings className="size-4" aria-hidden /> Settings
            </Link>
            <form action={signOut}>
              <button role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-negative hover:bg-surface-muted">
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
