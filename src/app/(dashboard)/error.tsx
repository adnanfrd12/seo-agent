"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

/** Keeps the sidebar and header; only the page area shows the error, with a retry. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center rounded-[10px] border border-border bg-surface p-10 text-center">
      <AlertTriangle className="size-8 text-negative" aria-hidden />
      <h2 className="mt-3 font-semibold">Something went wrong loading this page</h2>
      <p className="mt-1 max-w-md text-sm text-muted">
        Your data is safe. This is usually temporary; try again, and if it keeps happening check the Integrations page.
      </p>
      <button
        onClick={reset}
        className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        <RotateCw className="size-4" aria-hidden /> Try again
      </button>
    </div>
  );
}
