import { BRAND_NAME } from "@/components/brand/brand-mark";

/**
 * Illustrative dashboard mock for the sign-in page. Static demo figures, drawn as one SVG so it
 * scales to any width without overflow. Exposed to assistive tech as a single image.
 */

const W = 1000;
const H = 620;
const INK = "#16161a";
const MUTED = "#8a8a94";
const LINE = "#EFEAE5";
const UP = "#16A34A";
const ORANGE = "#F26A1B";
const FONT = "var(--font-geist-sans), system-ui, sans-serif";

const NAV = ["Overview", "Google Analytics", "Search Console", "Business Profile", "Bing Webmaster", "Microsoft Clarity"];
const RESEARCH = ["Competitors", "Keywords"];
const NAV_COLORS = ["#F26A1B", "#F9AB00", "#4285F4", "#1A73E8", "#00A4A6", "#7B61FF"];

const KPIS = [
  { label: "Organic Traffic", value: "12.4K", delta: "18%", color: "#F26A1B", data: [8, 9, 8.5, 10, 9.5, 11, 10.5, 12, 12.4] },
  { label: "Search Impressions", value: "523K", delta: "12%", color: "#4285F4", data: [40, 42, 41, 45, 44, 47, 49, 48, 52] },
  { label: "Profile Views", value: "8.2K", delta: "24%", color: "#7B61FF", data: [5, 5.4, 5.2, 6, 6.4, 6.1, 7, 7.6, 8.2] },
  { label: "Conversions", value: "1.2K", delta: "16%", color: "#16A34A", data: [0.8, 0.85, 0.9, 0.88, 1, 0.97, 1.08, 1.1, 1.2] },
];

const TRAFFIC = [
  310, 330, 322, 348, 340, 365, 352, 372, 360, 390, 378, 402, 388, 410, 398, 425, 412, 436, 420, 448,
  432, 455, 446, 470, 458, 482, 470, 492, 488, 510,
];

const SOURCES = [
  { label: "Google Search", pct: 45, color: "#F26A1B" },
  { label: "Direct", pct: 22, color: "#F59E0B" },
  { label: "Google Business", pct: 14, color: "#4285F4" },
  { label: "Bing", pct: 8, color: "#00A4A6" },
  { label: "Referral", pct: 6, color: "#7B61FF" },
  { label: "Social", pct: 5, color: "#EC4899" },
];

/** Polyline points for a series scaled into a box. */
function points(data: number[], x: number, y: number, w: number, h: number, min?: number, max?: number) {
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  return data.map((v, i) => [x + (i / (data.length - 1)) * w, y + h - ((v - lo) / (hi - lo || 1)) * h] as const);
}
const toPath = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");

export function LoginPreview({ className }: { className?: string }) {
  // Website Traffic chart geometry
  const cx = 250, cy = 290, cw = 420, ch = 250;
  const tPts = points(TRAFFIC, cx, cy, cw, ch, 250, 550);
  const tLine = toPath(tPts);
  const tArea = `${tLine} L${cx + cw} ${cy + ch} L${cx} ${cy + ch} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" fontFamily={FONT}
      aria-label={`Example ${BRAND_NAME} overview dashboard with traffic, impressions, profile views and conversions, a website traffic chart and top traffic sources. Illustrative figures only.`}>
      <defs>
        <linearGradient id="lp-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={ORANGE} stopOpacity="0.28" />
          <stop offset="1" stopColor={ORANGE} stopOpacity="0" />
        </linearGradient>
        <clipPath id="lp-frame"><rect width={W} height={H} rx="18" /></clipPath>
      </defs>

      <g clipPath="url(#lp-frame)">
        <rect width={W} height={H} fill="#fff" />

        {/* sidebar */}
        <rect width="200" height={H} fill="#FCFAF8" />
        <line x1="200" x2="200" y1="0" y2={H} stroke={LINE} />
        <g transform="translate(22 26)">
          <rect x="0" y="12" width="6" height="12" rx="3" fill="#D93A2B" />
          <rect x="8" y="6" width="6" height="18" rx="3" fill="#F2701E" />
          <rect x="16" y="0" width="6" height="24" rx="3" fill="#EA4A2A" />
          <text x="32" y="18" fontSize="15" fontWeight="700" fill={INK}>{BRAND_NAME}</text>
        </g>
        {NAV.map((label, i) => {
          const y = 82 + i * 38;
          const active = i === 0;
          return (
            <g key={label}>
              {active && <rect x="12" y={y - 4} width="176" height="32" rx="9" fill="#FFEFE5" />}
              <rect x="26" y={y + 5} width="14" height="14" rx="4" fill={active ? ORANGE : NAV_COLORS[i]} opacity={active ? 1 : 0.85} />
              <text x="50" y={y + 16.5} fontSize="12.5" fontWeight={active ? 700 : 500} fill={active ? "#E8452C" : "#4a4a52"}>{label}</text>
            </g>
          );
        })}
        <text x="26" y="330" fontSize="10" fontWeight="700" letterSpacing="1.4" fill="#a0a0aa">SEO RESEARCH</text>
        {RESEARCH.map((label, i) => {
          const y = 344 + i * 38;
          return (
            <g key={label}>
              <circle cx="33" cy={y + 12} r="6.5" fill="none" stroke="#9a9aa5" strokeWidth="1.8" />
              <text x="50" y={y + 16.5} fontSize="12.5" fontWeight="500" fill="#4a4a52">{label}</text>
            </g>
          );
        })}

        {/* header */}
        <text x="228" y="48" fontSize="22" fontWeight="800" fill={INK}>Overview</text>
        <text x="228" y="70" fontSize="12" fill={MUTED}>Your complete SEO performance at a glance</text>
        <rect x="862" y="30" width="114" height="32" rx="9" fill="#fff" stroke="#E7E2DD" />
        <text x="878" y="50.5" fontSize="12" fontWeight="600" fill="#3a3a42">Last 30 days</text>
        <path d="M956 43 l4.5 4.5 4.5 -4.5" fill="none" stroke="#8a8a94" strokeWidth="1.6" strokeLinecap="round" />

        {/* KPI cards */}
        {KPIS.map((k, i) => {
          const x = 228 + i * 190;
          const spark = points(k.data, x + 104, 128, 68, 34);
          return (
            <g key={k.label}>
              <rect x={x} y="88" width="176" height="104" rx="14" fill="#fff" stroke={LINE} />
              <text x={x + 16} y="112" fontSize="11.5" fontWeight="500" fill={MUTED}>{k.label}</text>
              <text x={x + 16} y="146" fontSize="25" fontWeight="800" fill={INK}>{k.value}</text>
              <text x={x + 16} y="174" fontSize="11.5" fontWeight="700" fill={UP}>↑ {k.delta}</text>
              <path d={toPath(spark)} fill="none" stroke={k.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}

        {/* Website Traffic */}
        <rect x="228" y="208" width="462" height="390" rx="14" fill="#fff" stroke={LINE} />
        <text x="248" y="240" fontSize="15" fontWeight="700" fill={INK}>Website Traffic</text>
        <text x="370" y="240" fontSize="11.5" fontWeight="700" fill={UP}>↑ 18%</text>
        <rect x="592" y="222" width="82" height="28" rx="8" fill="#fff" stroke="#E7E2DD" />
        <text x="604" y="240" fontSize="11.5" fontWeight="600" fill="#3a3a42">Sessions</text>
        <path d="M656 234 l4 4 4 -4" fill="none" stroke="#8a8a94" strokeWidth="1.5" strokeLinecap="round" />
        {[0, 1, 2, 3].map((g) => (
          <line key={g} x1={cx} x2={cx + cw} y1={cy + (g * ch) / 3} y2={cy + (g * ch) / 3} stroke="#F3EFEB" strokeDasharray="3 4" />
        ))}
        <path d={tArea} fill="url(#lp-area)" />
        <path d={tLine} fill="none" stroke={ORANGE} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={tPts[tPts.length - 1][0]} cy={tPts[tPts.length - 1][1]} r="5" fill="#fff" stroke={ORANGE} strokeWidth="2.5" />
        {["Oct 1", "Oct 8", "Oct 15", "Oct 22", "Oct 30"].map((d, i) => (
          <text key={d} x={cx + (i * cw) / 4} y={cy + ch + 24} fontSize="10.5" fill={MUTED} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{d}</text>
        ))}

        {/* Top Sources */}
        <rect x="704" y="208" width="272" height="390" rx="14" fill="#fff" stroke={LINE} />
        <text x="724" y="240" fontSize="15" fontWeight="700" fill={INK}>Top Sources</text>
        {SOURCES.map((s, i) => {
          const y = 280 + i * 50;
          return (
            <g key={s.label}>
              <text x="724" y={y} fontSize="12" fontWeight="500" fill="#3a3a42">{s.label}</text>
              <text x="956" y={y} fontSize="12" fontWeight="700" fill={INK} textAnchor="end">{s.pct}%</text>
              <rect x="724" y={y + 10} width="232" height="7" rx="3.5" fill="#F4F0EC" />
              <rect x="724" y={y + 10} width={(232 * s.pct) / 50} height="7" rx="3.5" fill={s.color} />
            </g>
          );
        })}
      </g>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="18" fill="none" stroke="#EAE4DE" />
    </svg>
  );
}
