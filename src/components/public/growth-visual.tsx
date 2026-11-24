/**
 * Sign-in artwork: a year of daily search clicks drawn as a field of fine bars, rising, with editorial annotations.
 * Generated deterministically on the server (no image file, no client JS), sharp at any size.
 */
const W = 640, H = 760, N = 104, BASE = 640, LEFT = 48, RIGHT = 592;

function series(): number[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const trend = 0.16 + 0.62 * t ** 1.8;                 // growth
    const week = 0.05 * Math.sin(i * 0.9);                 // weekly rhythm
    return Math.max(0.05, trend + week + (rnd() - 0.5) * 0.09);
  });
}

export function GrowthVisual({ className }: { className?: string }) {
  const v = series();
  const step = (RIGHT - LEFT) / N, bw = step * 0.42;
  const hOf = (x: number) => x * 420;
  const quickWin = 70; // the annotated day
  const trend = v.map((x, i) => {
    const s = v.slice(Math.max(0, i - 6), i + 1);
    return [LEFT + i * step + bw / 2, BASE - hOf(s.reduce((a, b) => a + b, 0) / s.length) - 14] as const;
  });
  const line = trend.slice(6).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [qx, qy] = trend[quickWin];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="Illustration: search clicks rising over a year, with an AI quick win marked where growth begins">
      {/* grid */}
      {[0, 1, 2, 3, 4].map((k) => (
        <line key={k} x1={LEFT} x2={RIGHT} y1={BASE - k * 105} y2={BASE - k * 105} stroke="#FFFFFF" strokeOpacity={k ? 0.06 : 0.18} />
      ))}
      {/* bars */}
      {v.map((x, i) => (
        <rect key={i} x={LEFT + i * step} y={BASE - hOf(x)} width={bw} height={hOf(x)} rx={bw / 2}
          fill={i >= quickWin ? "#F2701E" : "#FFFFFF"} fillOpacity={i >= quickWin ? 0.35 + 0.6 * ((i - quickWin) / (N - quickWin)) : 0.16} />
      ))}
      {/* 7-day trend */}
      <path d={line} fill="none" stroke="#FFB27A" strokeWidth="1.6" strokeLinejoin="round" />

      {/* quick win marker */}
      <line x1={qx} x2={qx} y1={qy - 8} y2={196} stroke="#FFFFFF" strokeOpacity="0.4" strokeDasharray="2 4" />
      <circle cx={qx} cy={qy} r="5" fill="#17120E" stroke="#FFB27A" strokeWidth="2" />
      <g transform={`translate(${qx - 196} 120)`} fontFamily="var(--font-public-sans), sans-serif">
        <text fill="#FFB27A" fontSize="11" letterSpacing="1.6" fontWeight="600">AI QUICK WIN · APPLIED</text>
        <text y="26" fill="#FFFFFF" fontSize="17" fontWeight="500">Title rewritten for</text>
        <text y="48" fill="#FFFFFF" fontSize="17" fontWeight="500">“led signs houston”</text>
        <text y="70" fill="#FFFFFF" fillOpacity="0.55" fontSize="13">Position 14 → 6 in five weeks</text>
      </g>

      {/* axis labels */}
      <g fontFamily="var(--font-public-sans), sans-serif" fontSize="11" fill="#FFFFFF" fillOpacity="0.45" letterSpacing="1.2">
        <text x={LEFT} y={BASE + 28}>JAN</text>
        <text x={(LEFT + RIGHT) / 2} y={BASE + 28} textAnchor="middle">JUN</text>
        <text x={RIGHT} y={BASE + 28} textAnchor="end">DEC</text>
      </g>
      <g fontFamily="var(--font-public-sans), sans-serif">
        <text x={RIGHT} y={BASE - hOf(Math.max(...v)) - 52} textAnchor="end" fill="#FFFFFF" fontSize="30" fontWeight="600" letterSpacing="-0.5">+212%</text>
        <text x={RIGHT} y={BASE - hOf(Math.max(...v)) - 32} textAnchor="end" fill="#FFFFFF" fillOpacity="0.5" fontSize="12">organic clicks</text>
      </g>
    </svg>
  );
}
