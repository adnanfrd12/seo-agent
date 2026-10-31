"use client";

import { useState } from "react";

export interface GeoCard {
  id: string; term: string; meta: string;
  stats: { k: string; v: string; delta: { better: boolean; before: string } | null }[];
  ranks: (number | string)[][] | null; publicUrl: string | null; imageUrl: string | null;
}

/** Rank cell colour: top 3 green, 4-10 amber, 11-20 orange, not ranked grey. */
function cellClass(v: number | string) {
  const r = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(r)) return "bg-surface-muted text-muted";
  if (r <= 3) return "bg-positive text-white";
  if (r <= 10) return "bg-warn text-white";
  return "bg-negative/70 text-white";
}

// the shared cell styling sits on the grid, so each of the hundreds of cells carries only its colour
function Grid({ ranks }: { ranks: (number | string)[][] }) {
  const size = ranks.length;
  return (
    <div className="grid gap-px [&>span]:flex [&>span]:aspect-square [&>span]:items-center [&>span]:justify-center [&>span]:rounded-[2px] [&>span]:text-[9px] [&>span]:font-semibold"
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} role="img" aria-label={`Rank grid, ${size} by ${size}. X means not in the top 20.`}>
      {ranks.flatMap((row, y) => row.map((v, x) => <span key={`${y}-${x}`} className={cellClass(v)}>{String(v) === "X" ? "" : v}</span>))}
    </div>
  );
}

const MD_SPAN: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2" };
const XL_SPAN: Record<number, string> = { 1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3" };
const link = "text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground";

/**
 * One card per search term. The first `initial` render with the page; the rest render on request, so a
 * client tracking 70 terms doesn't ship tens of thousands of grid cells with every page view.
 */
export function GeoCards({ cards, initial, closer }: { cards: GeoCard[]; initial: number; closer: React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, initial);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => (
          <article key={g.id} className="rounded-lg border border-border p-3">
            <h3 className="font-semibold">“{g.term}”</h3>
            <p className="text-xs text-muted">{g.meta}</p>
            <dl className="my-2 grid grid-cols-3 gap-2 text-center text-sm">
              {g.stats.map((s) => (
                <div key={s.k} className="rounded-md bg-surface-muted p-1.5">
                  <dt className="text-[10px] font-semibold uppercase text-muted">{s.k}</dt>
                  <dd className="font-bold tabular-nums">{s.v}</dd>
                  {s.delta && <dd className={`text-[10px] ${s.delta.better ? "text-positive" : "text-negative"}`}>{s.delta.better ? "better" : "worse"} than {s.delta.before}</dd>}
                </div>
              ))}
            </dl>
            {g.ranks && g.ranks.length > 0 && <Grid ranks={g.ranks} />}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {g.publicUrl && <a href={g.publicUrl} target="_blank" rel="noopener noreferrer" className={link}>Open report →</a>}
              {g.imageUrl && <a href={g.imageUrl} target="_blank" rel="noopener noreferrer" className={link}>Map image →</a>}
            </div>
          </article>
        ))}
        {/* the closing card is sized to finish the last row, however many cards are showing */}
        <div className={`flex [&>*]:flex-1 ${MD_SPAN[2 - (shown.length % 2)]} ${XL_SPAN[3 - (shown.length % 3)]}`}>{closer}</div>
      </div>
      {cards.length > initial && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-4 rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-surface-muted">
          {all ? `Show the first ${initial} terms` : `Show all ${cards.length} terms`}
        </button>
      )}
    </>
  );
}
