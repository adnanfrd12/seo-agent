"use client";

import { useState } from "react";
import { Panel } from "./ai-charts";

/**
 * Where the blog's posts point on the map: each neighbourhood a post targets, placed by distance and
 * direction from the business (north up), with rings every few miles. No map tiles, so nothing is
 * loaded from a map provider; hover a dot for the area and how many posts target it.
 */
export function GeoSpread({ title, sub, center, points }: {
  title: string; sub?: string;
  center: { lat: number; lng: number; label: string };
  points: { name: string; lat: number; lng: number; count: number; zip: string | null }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 360, cx = W / 2, cy = H / 2;
  const kx = 69.17 * Math.cos((center.lat * Math.PI) / 180), ky = 69.05; // miles per degree
  const pts = points.map((p) => {
    const dx = (p.lng - center.lng) * kx, dy = (p.lat - center.lat) * ky;
    return { ...p, dx, dy, miles: Math.round(Math.hypot(dx, dy) * 10) / 10 };
  });
  const far = Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.dx) * (H / W), Math.abs(p.dy))));
  const step = [0.5, 1, 2, 5, 10, 20, 50].find((s) => far / s <= 4) ?? 100;
  const rings = Math.max(1, Math.ceil(far / step));
  const scale = (H / 2 - 18) / (rings * step);
  const maxCount = Math.max(1, ...pts.map((p) => p.count));
  const r = (n: number) => 4 + Math.sqrt(n / maxCount) * 9;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const hp = hover == null ? null : pts[hover];
  return (
    <Panel title={title} sub={sub} right={<span className="text-xs text-muted">rings every {step} mi</span>}>
      {pts.length === 0 ? <p className="py-8 text-center text-sm text-muted">No post names an area with a map link yet.</p> : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${pts.length} areas around ${center.label}`}>
            {Array.from({ length: rings }, (_, i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r={round2((i + 1) * step * scale)} fill="none" stroke="var(--hairline)" strokeDasharray={i === rings - 1 ? undefined : "3 4"} />
                <text x={cx + 4} y={round2(cy - (i + 1) * step * scale) + 12} fontSize="10" fill="var(--faint)">{(i + 1) * step} mi</text>
              </g>
            ))}
            <text x={cx} y={12} textAnchor="middle" fontSize="10" fill="var(--muted)">N</text>
            {pts.map((p, i) => (
              <circle key={`${p.name}-${i}`} cx={round2(cx + p.dx * scale)} cy={round2(cy - p.dy * scale)} r={round2(r(p.count))}
                fill="color-mix(in oklab, var(--series) 70%, transparent)" stroke="var(--surface)" strokeWidth="1.5"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-default" />
            ))}
            <circle cx={cx} cy={cy} r="7" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </svg>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><span className="size-2.5 rounded-full bg-accent" aria-hidden /> {center.label}</p>
          {hp && (
            <div role="tooltip" className="pointer-events-none absolute left-3 top-3 rounded-lg border border-border bg-surface p-2.5 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]">
              <p className="font-medium">{hp.name}{hp.zip ? ` · ${hp.zip}` : ""}</p>
              <p className="text-secondary">{hp.count} post{hp.count === 1 ? "" : "s"} · {hp.miles} mi from the business</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
