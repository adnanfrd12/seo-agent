import { cn } from "@/lib/utils";

/**
 * Decorative illustration of the dashboard on a laptop. It deliberately shows NO figures:
 * values are neutral placeholder bars and the chart shapes are generic, so it can never be mistaken
 * for real analytics. Pure SVG: crisp at any size, no image files to host.
 */
export function DashboardPreview({ tilt = true, className }: { tilt?: boolean; className?: string }) {
  const nav = [
    { label: "Overview", active: true },
    { label: "Google Analytics" },
    { label: "Search Console" },
    { label: "Business Profile" },
    { label: "Reports" },
    { label: "Integrations" },
    { label: "Settings" },
  ];
  const kpis = [
    { label: "Total Users", color: "#4F7CF7" },
    { label: "Organic Clicks", color: "#4F7CF7" },
    { label: "Profile Views", color: "#EA4A2A" },
    { label: "Conversions", color: "#F2A81E" },
  ];
  const legend = [
    { label: "Organic Search", color: "#34A853" },
    { label: "Direct", color: "#4F7CF7" },
    { label: "Referral", color: "#F2A81E" },
    { label: "Social", color: "#8B5CF6" },
    { label: "Paid Search", color: "#EA4A2A" },
  ];
  // donut segments (decorative proportions), circumference of r=30 is ~188.5
  const donut = [
    { len: 76, color: "#34A853" }, { len: 52, color: "#4F7CF7" }, { len: 26, color: "#F2A81E" },
    { len: 20, color: "#8B5CF6" }, { len: 14.5, color: "#EA4A2A" },
  ];
  const segments = donut.map((s, i) => ({ ...s, start: donut.slice(0, i).reduce((a, b) => a + b.len, 0) }));
  const bars = [14, 24, 18, 34, 22, 40, 28, 46, 30, 38, 26, 44, 32, 52, 36, 42, 30, 48, 34, 40];

  return (
    <div
      className={cn("select-none", className)}
      style={
        tilt
          ? { transform: "perspective(1800px) rotateY(-14deg) rotateX(5deg) rotateZ(1.2deg)", transformOrigin: "left center", filter: "drop-shadow(0 28px 36px rgba(25,28,45,.28))" }
          : { filter: "drop-shadow(0 18px 28px rgba(25,28,45,.18))" }
      }
      aria-hidden
    >
      <svg viewBox="0 0 760 500" className="h-auto w-full" fontFamily="system-ui, sans-serif">
        <defs>
          <linearGradient id="dp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4F7CF7" stopOpacity=".35" />
            <stop offset="1" stopColor="#4F7CF7" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dp-base" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9dbe1" /><stop offset="1" stopColor="#b9bcc6" />
          </linearGradient>
        </defs>

        {/* laptop base */}
        <path d="M-10 478h780l-26 14H16z" fill="url(#dp-base)" />
        {/* lid + bezel */}
        <rect x="0" y="0" width="760" height="480" rx="22" fill="#15171c" />
        <rect x="10" y="10" width="740" height="460" rx="14" fill="#f4f5f8" />

        {/* sidebar */}
        <path d="M24 10h146v460H24a14 14 0 0 1-14-14V24a14 14 0 0 1 14-14z" fill="#1b1e26" />
        <rect x="26" y="26" width="5" height="10" rx="2.5" fill="#D93A2B" />
        <rect x="33" y="22" width="5" height="14" rx="2.5" fill="#F2701E" />
        <rect x="40" y="18" width="5" height="18" rx="2.5" fill="#EA4A2A" />
        <text x="52" y="33" fill="#fff" fontSize="10" fontWeight="700">SEO Insights</text>
        {nav.map((n, i) => (
          <g key={n.label} transform={`translate(0 ${64 + i * 30})`}>
            {n.active && <rect x="18" y="-12" width="140" height="24" rx="7" fill="#EA4A2A" opacity=".95" />}
            <rect x="30" y="-5" width="9" height="9" rx="2.5" fill={n.active ? "#fff" : "#7d8493"} />
            <text x="46" y="3" fontSize="9" fill={n.active ? "#fff" : "#b6bbc7"} fontWeight={n.active ? 700 : 500}>{n.label}</text>
          </g>
        ))}

        {/* header */}
        <text x="190" y="42" fontSize="15" fontWeight="700" fill="#16161a">Dashboard</text>
        <rect x="620" y="26" width="112" height="22" rx="7" fill="#fff" stroke="#e4e4e8" />
        <rect x="630" y="33" width="9" height="9" rx="2" fill="none" stroke="#6b6b76" />
        <text x="645" y="41" fontSize="8.5" fill="#44444c">Last 30 days</text>

        {/* KPI tiles: values are neutral placeholder bars, never numbers */}
        {kpis.map((k, i) => (
          <g key={k.label} transform={`translate(${190 + i * 140} 64)`}>
            <rect width="130" height="68" rx="10" fill="#fff" stroke="#ececf0" />
            <circle cx="22" cy="24" r="11" fill={k.color} opacity=".14" />
            <rect x="17" y="19" width="10" height="10" rx="3" fill={k.color} />
            <text x="42" y="22" fontSize="8" fill="#6b6b76">{k.label}</text>
            <rect x="42" y="30" width="54" height="11" rx="5.5" fill="#e6e7ec" />
            <rect x="42" y="49" width="30" height="6" rx="3" fill="#bfe6d2" />
          </g>
        ))}

        {/* website traffic */}
        <g transform="translate(190 146)">
          <rect width="272" height="146" rx="10" fill="#fff" stroke="#ececf0" />
          <text x="14" y="22" fontSize="9.5" fontWeight="700" fill="#16161a">Website Traffic</text>
          {[0, 1, 2, 3].map((i) => <line key={i} x1="14" x2="258" y1={44 + i * 22} y2={44 + i * 22} stroke="#eef0f4" />)}
          <path d="M14 108 L38 100 62 103 86 86 110 90 134 72 158 78 182 58 206 64 230 44 258 36 V110 H14Z" fill="url(#dp-area)" />
          <path d="M14 108 L38 100 62 103 86 86 110 90 134 72 158 78 182 58 206 64 230 44 258 36" fill="none" stroke="#4F7CF7" strokeWidth="2" strokeLinejoin="round" />
        </g>

        {/* organic search performance */}
        <g transform="translate(472 146)">
          <rect width="268" height="146" rx="10" fill="#fff" stroke="#ececf0" />
          <text x="14" y="22" fontSize="9.5" fontWeight="700" fill="#16161a">Organic Search Performance</text>
          <circle cx="16" cy="34" r="2.5" fill="#EA4A2A" /><text x="22" y="37" fontSize="7.5" fill="#6b6b76">Clicks</text>
          <circle cx="56" cy="34" r="2.5" fill="#8B5CF6" /><text x="62" y="37" fontSize="7.5" fill="#6b6b76">Impressions</text>
          {[0, 1, 2, 3].map((i) => <line key={i} x1="14" x2="254" y1={50 + i * 20} y2={50 + i * 20} stroke="#eef0f4" />)}
          <path d="M14 104 L40 96 66 100 92 82 118 88 144 66 170 72 196 52 222 60 254 40" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinejoin="round" />
          <path d="M14 112 L40 108 66 110 92 98 118 102 144 90 170 94 196 80 222 84 254 70" fill="none" stroke="#F2A81E" strokeWidth="2" strokeLinejoin="round" />
        </g>

        {/* top traffic sources */}
        <g transform="translate(190 304)">
          <rect width="272" height="154" rx="10" fill="#fff" stroke="#ececf0" />
          <text x="14" y="22" fontSize="9.5" fontWeight="700" fill="#16161a">Top Traffic Sources</text>
          <g transform="translate(68 88) rotate(-90)">
            {segments.map((s) => (
              <circle key={s.color} r="30" fill="none" stroke={s.color} strokeWidth="14"
                strokeDasharray={`${s.len - 1.5} ${188.5 - s.len + 1.5}`} strokeDashoffset={-s.start} />
            ))}
          </g>
          {legend.map((l, i) => (
            <g key={l.label} transform={`translate(138 ${48 + i * 20})`}>
              <circle cx="3" cy="3" r="3" fill={l.color} />
              <text x="12" y="6" fontSize="8" fill="#44444c">{l.label}</text>
              <rect x="86" y="0" width="22" height="6" rx="3" fill="#e6e7ec" />
            </g>
          ))}
        </g>

        {/* business profile interactions */}
        <g transform="translate(472 304)">
          <rect width="268" height="154" rx="10" fill="#fff" stroke="#ececf0" />
          <text x="14" y="22" fontSize="9.5" fontWeight="700" fill="#16161a">Business Profile Interactions</text>
          {[0, 1, 2, 3].map((i) => <line key={i} x1="14" x2="254" y1={44 + i * 24} y2={44 + i * 24} stroke="#eef0f4" />)}
          {bars.map((h, i) => (
            <rect key={i} x={16 + i * 12} y={116 - h * 1.5} width="7" height={h * 1.5} rx="3" fill="#EA4A2A" opacity={0.55 + (h % 5) * 0.09} />
          ))}
        </g>
      </svg>
    </div>
  );
}
