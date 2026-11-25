"use client";

import { useEffect, useId, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Dialog buttons: a little larger than the inline ones. */
const base = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60";
export const dialogBtn = {
  primary: `${base} bg-accent text-accent-foreground hover:opacity-90`,
  secondary: `${base} border border-border bg-surface text-foreground hover:bg-surface-muted`,
  danger: `${base} bg-negative text-surface hover:opacity-90`,
  ghost: `${base} px-2.5 text-secondary hover:bg-surface-muted hover:text-foreground`,
};

/**
 * Modal dialog on the native <dialog> element: focus moves inside and stays there, the page behind is inert,
 * Esc or a click outside closes it (not while `busy`), and focus goes back to the button that opened it.
 * The element marked `data-autofocus` gets focus when it opens.
 */
export function Dialog({ open, onClose, title, description, icon, children, size = "md", busy = false }: {
  open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode;
  children?: React.ReactNode; size?: "sm" | "md"; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      // the browser can still close it (e.g. Esc pressed twice); keep the state in step
      onClose={() => { if (open) onClose(); }}
      onClick={(e) => {
        if (busy || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
      className={cn(
        "app-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-0 text-foreground shadow-[0_24px_64px_-20px_rgb(0_0_0/0.45)]",
        "backdrop:bg-black/40 dark:backdrop:bg-black/65",
        size === "sm" ? "max-w-[27rem]" : "max-w-[35rem]",
      )}
    >
      {open && (
        <>
          <div className="flex items-start gap-3.5 px-5 pt-5">
            {icon}
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={`${id}-title`} className="text-[17px] font-semibold leading-snug tracking-[-0.01em]">{title}</h2>
              {description && <div id={`${id}-desc`} className="mt-1 text-sm leading-relaxed text-secondary">{description}</div>}
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
              className="-mr-1.5 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted outline-none transition hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

export function DialogBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 pb-5 pt-4 text-sm leading-relaxed text-secondary", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-surface-sunken px-5 py-3.5", className)}>{children}</div>;
}

/** A yes/no question before something that can't be undone. "Cancel" has the focus, so Enter never confirms by accident. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, cancelLabel = "Cancel", busy = false, error, icon, tone = "danger" }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: React.ReactNode; children: React.ReactNode;
  confirmLabel: string; cancelLabel?: string; busy?: boolean; error?: string | null; icon?: React.ReactNode; tone?: "danger" | "primary";
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm" busy={busy} icon={icon}>
      <DialogBody className="pt-2">
        {children}
        {error && <p role="alert" className="mt-3 rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative">{error}</p>}
      </DialogBody>
      <DialogFooter>
        <button type="button" data-autofocus className={dialogBtn.secondary} onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={tone === "danger" ? dialogBtn.danger : dialogBtn.primary} onClick={onConfirm} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {confirmLabel}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
