/** Skeleton with the same footprint as the analytics pages, so content swaps in without a jump. */
export default function Loading() {
  const block = "animate-pulse rounded-xl bg-surface-muted";
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <div className={`${block} h-7 w-56`} />
        <div className={`${block} h-4 w-80 max-w-full`} />
      </div>
      <div className={`${block} mb-5 h-10 w-full max-w-xl`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`${block} h-36`} />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className={`${block} h-[19.5rem]`} />
        <div className={`${block} h-[19.5rem]`} />
      </div>
      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}
