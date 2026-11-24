"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteWorkspace } from "./actions";

/** Owner-only: deletes the whole workspace (connections, data, members who belong nowhere else). */
export function DeleteWorkspace({ name }: { name: string }) {
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Deletes <strong className="text-foreground">{name}</strong> permanently: every connected account is disconnected and its access removed,
        all data, reports and history are deleted, and team members who belong to no other workspace lose their login. This can&apos;t be undone.
      </p>
      <label className="block">
        <span className="mb-1 block font-medium">Type the workspace name to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="off"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      </label>
      <button type="button" disabled={pending || typed.trim() !== name.trim()}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await deleteWorkspace(typed);
          // a full reload on purpose: the deleted workspace is still the session's active client in memory
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          if (r.ok) window.location.assign("/overview"); else setMsg({ ok: false, text: r.error });
        })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-negative/40 px-3 py-1.5 font-medium text-negative outline-none hover:bg-negative-soft focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete workspace
      </button>
      {msg && <p role="alert" className="text-negative">{msg.text}</p>}
    </div>
  );
}
