export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">{title}</h1>
      {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-secondary">{description}</p>}
    </div>
  );
}

export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-[10px] border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-secondary">{body}</p>
      {action && (
        <a href={action.href}
          className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:opacity-90">
          {action.label}
        </a>
      )}
    </div>
  );
}
