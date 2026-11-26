"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Loader2, MessageSquareReply, Star } from "lucide-react";
import { ConfirmButton } from "@/components/dashboard/dialog";
import { deleteReply, replyToReview } from "@/app/(dashboard)/business-profile/actions";
import { cn } from "@/lib/utils";

export type ReviewItem = {
  id: string; rating: number | null; text: string | null; reviewer: string | null; photo: string | null;
  reply: string | null; repliedAt: string | null; replyState: string | null; reviewedAt: string | null; location: string | null;
};

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
const PAGE = 20;

/**
 * Every review with its status ("Owner replied" / "Not replied"), the owner's reply in its own tinted box, and a reply
 * box for owners/admins that posts through the Business Profile API. `replyBlocked` explains why replying isn't
 * available (no Google connection, or access not approved yet).
 */
export function ReviewsPanel({ reviews, canEdit, replyBlocked }: { reviews: ReviewItem[]; canEdit: boolean; replyBlocked: string | null }) {
  const [items, setItems] = useState(reviews);
  const [filter, setFilter] = useState<"all" | "open" | "replied">("all");
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => items.filter((r) => filter === "all" || (filter === "open" ? !r.reply : Boolean(r.reply))), [items, filter]);
  const open = items.filter((r) => !r.reply).length;
  const update = (id: string, reply: string | null, repliedAt: string | null) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, reply, repliedAt, replyState: null } : r)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter reviews">
        {([["all", `All (${items.length})`], ["open", `Not replied (${open})`], ["replied", `Owner replied (${items.length - open})`]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(PAGE); }}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === k ? "border-foreground bg-foreground text-surface" : "border-border text-secondary hover:bg-surface-muted")}>
            {label}
          </button>
        ))}
      </div>
      {canEdit && replyBlocked && <p className="mb-3 rounded-lg bg-surface-muted p-2.5 text-xs text-secondary">{replyBlocked}</p>}
      {list.length === 0 ? <p className="py-6 text-center text-sm text-muted">No reviews here.</p> : (
        <ul className="space-y-3">
          {list.slice(0, shown).map((r) => <ReviewCard key={r.id} r={r} canReply={canEdit && !replyBlocked} onChange={update} />)}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" className={cn(btn2, "mt-3")} onClick={() => setShown((n) => n + PAGE * 2)}>Show more ({list.length - shown} left)</button>
      )}
    </div>
  );
}

function ReviewCard({ r, canReply, onChange }: { r: ReviewItem; canReply: boolean; onChange: (id: string, reply: string | null, at: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(r.reply ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const submit = () => start(async () => {
    setErr(null);
    const res = await replyToReview(r.id, draft);
    if (res.ok) { onChange(r.id, res.reply ?? draft, res.repliedAt ?? null); setEditing(false); } else setErr(res.error);
  });
  const remove = async () => {
    const res = await deleteReply(r.id);
    if (res.ok) { onChange(r.id, null, null); setDraft(""); } else setErr(res.error);
  };

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{r.reviewer ?? "Google user"}</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            {r.rating != null && <span className="inline-flex items-center gap-0.5 text-warn" aria-label={`${r.rating} out of 5 stars`}>
              {Array.from({ length: 5 }, (_, i) => <Star key={i} className={cn("size-3.5", i < r.rating! ? "fill-current" : "opacity-30")} aria-hidden />)}
            </span>}
            <span>{day(r.reviewedAt)}</span>{r.location && <span className="truncate">· {r.location}</span>}
          </p>
        </div>
        {r.reply
          ? <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-medium text-positive"><CheckCircle2 className="size-3" aria-hidden /> Owner replied</span>
          : <span className="rounded-full bg-negative-soft px-2 py-0.5 text-[11px] font-medium text-negative">Not replied</span>}
      </div>
      {r.text ? <p className="mt-2 whitespace-pre-line">{r.text}</p> : <p className="mt-2 text-muted">(rating only, no text)</p>}

      {r.reply && !editing && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3">
          <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-warn">
            <MessageSquareReply className="size-3.5" aria-hidden /> Owner reply
            {r.repliedAt && <span className="font-normal text-secondary">{day(r.repliedAt)}</span>}
            {r.replyState && r.replyState !== "APPROVED" && <span className="font-normal text-secondary">· {r.replyState.toLowerCase()} by Google</span>}
          </p>
          <p className="whitespace-pre-line text-foreground">{r.reply}</p>
          {canReply && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="text-xs font-medium text-secondary underline underline-offset-2 hover:text-foreground" onClick={() => { setDraft(r.reply ?? ""); setEditing(true); }}>Edit reply</button>
              <ConfirmButton className="text-xs font-medium text-secondary underline underline-offset-2 hover:text-foreground" onConfirm={remove}
                title="Delete this reply on Google?" confirmLabel="Delete reply" body={<p>The reply is removed from the review on Google.</p>}>Delete</ConfirmButton>
            </div>
          )}
        </div>
      )}

      {canReply && (editing || !r.reply) && (
        editing ? (
          <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className="sr-only" htmlFor={`reply-${r.id}`}>Reply</label>
            <textarea id={`reply-${r.id}`} rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder="Write a public reply…" />
            <div className="flex flex-wrap gap-2">
              <button className={btn} disabled={pending || !draft.trim()}>{pending && <Loader2 className="size-4 animate-spin" />} Post reply on Google</button>
              <button type="button" className={btn2} disabled={pending} onClick={() => { setEditing(false); setErr(null); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className={cn(btn2, "mt-3")} onClick={() => setEditing(true)}><MessageSquareReply className="size-4" aria-hidden /> Reply</button>
        )
      )}
      {err && <p role="alert" className="mt-2 text-xs text-negative">{err}</p>}
    </li>
  );
}
