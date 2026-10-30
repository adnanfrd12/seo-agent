/** Lighthouse's own score colours: 90-100 green, 50-89 orange, 0-49 red. */
export const lhColor = (n: number | null) => (n == null ? "var(--muted)" : n >= 90 ? "#0cce6b" : n >= 50 ? "#ffa400" : "#ff4e42");

/** A Lighthouse-style score gauge: coloured arc proportional to the score, the number in the middle, a label below. */
export function ScoreRing({ score, label, size = 56 }: { score: number | null; label: string; size?: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const color = lhColor(score);
  return (
    <div className="flex w-20 flex-col items-center gap-1 text-center">
      <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label={`${label}: ${score ?? "no score"}`}>
        <circle cx="28" cy="28" r={r} fill={score == null ? "none" : `${color}1a`} stroke="var(--border)" strokeWidth="5" />
        {score != null && (
          <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 28 28)" />
        )}
        <text x="28" y="33" textAnchor="middle" fontSize="15" fontWeight="700" fill={score == null ? "var(--muted)" : color}>{score ?? "—"}</text>
      </svg>
      <span className="text-xs leading-tight text-muted">{label}</span>
    </div>
  );
}
