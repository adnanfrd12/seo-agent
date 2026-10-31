/** Skeleton with the same footprint as the analytics pages, so content swaps in without a jump. */
export default function Loading() {
  const block = "skeleton rounded-[10px]";
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2.5">
        <div className={`${block} h-7 w-56`} />
        <div className={`${block} h-4 w-96 max-w-full`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`${block} h-[104px]`} />
        ))}
      </div>
      <div className={`${block} mt-6 h-[19.5rem]`} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className={`${block} h-56`} />
        <div className={`${block} h-56`} />
      </div>
      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}
