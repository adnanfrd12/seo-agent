"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

const noop = () => () => {};
/** Minutes since epoch in the browser; null while rendering on the server (so markup always matches). */
const useNowMinutes = () => useSyncExternalStore(noop, () => Math.floor(Date.now() / 60_000), () => null);

/** "Synced 11:07" with a status dot; links to Integrations, where syncs are managed. Formatted in the viewer's time zone. */
export function SyncStatus({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const now = useNowMinutes();
  let label = "Synced", stale = false;
  if (!lastSyncedAt) { label = "Not synced yet"; stale = true; }
  else if (now !== null) {
    const t = new Date(lastSyncedAt);
    const hours = (now * 60_000 - t.getTime()) / 3_600_000;
    label = hours < 24 ? `Synced ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `Synced ${t.toLocaleDateString([], { month: "short", day: "numeric" })}`;
    stale = hours > 36;
  }
  return (
    <Link href="/integrations" title={lastSyncedAt ? `Last sync ${lastSyncedAt.replace("T", " ").slice(0, 16)} UTC` : "No sync has finished yet"}
      className="hidden items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-muted hover:text-foreground lg:inline-flex">
      <span className={stale ? "size-1.5 rounded-full bg-warn" : "size-1.5 rounded-full bg-positive"} aria-hidden />
      {label}
    </Link>
  );
}
