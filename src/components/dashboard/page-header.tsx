export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
  );
}

export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
      <h2 className="font-medium">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && (
        <a href={action.href}
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
          {action.label}
        </a>
      )}
    </div>
  );
}
