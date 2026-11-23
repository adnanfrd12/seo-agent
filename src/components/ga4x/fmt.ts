/** Number formats used by the GA4 leads screens (passed to client charts by name). */
export type Fmt = "int" | "k" | "pct" | "dur" | "money" | "dec1" | "dec2" | "raw";

export function fmt(kind: Fmt | undefined, v: number | null | undefined, currency = "USD"): string {
  if (v == null || Number.isNaN(v)) return "–";
  switch (kind) {
    case "pct": return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 2 : 1)}%`;
    case "dur": { const s = Math.round(v), m = Math.floor(s / 60); return `${m ? `${m}m ` : ""}${s % 60}s`; }
    case "money": return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
    case "k": return v >= 10_000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : Math.round(v).toLocaleString("en-US");
    case "dec1": return v.toFixed(1);
    case "dec2": return v.toFixed(2);
    case "raw": return String(v);
    default: return Math.round(v).toLocaleString("en-US");
  }
}

/** Dashboard category colours (light and dark come from the theme tokens). */
export const C = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];
export const GOOD = "var(--positive)", BAD = "var(--negative)", MUTED = "var(--cat-other)";

/** The same colour for a lead type, channel or device on every chart. */
const TYPE_COLOR: Record<string, string> = { Calls: C[2], Forms: C[1], Directions: C[0], Email: C[6], "Text / chat": C[4], Booking: C[3], Purchase: C[5], "Form start": MUTED };
const CHANNEL_COLOR: Record<string, string> = { "Organic Search": C[0], Direct: C[3], "Organic Social": C[4], "Paid Search": C[1], Referral: C[2], "AI Assistant": C[6], Email: C[5], "Paid Social": C[7], Unassigned: MUTED, "(not set)": MUTED };
const DEVICE_COLOR: Record<string, string> = { mobile: C[0], desktop: C[1], tablet: C[2], "smart tv": C[3] };
export const typeColor = (t: string) => TYPE_COLOR[t] ?? MUTED;
export const channelColor = (ch: string, i = 0) => CHANNEL_COLOR[ch] ?? C[(i + 3) % C.length];
export const deviceColor = (d: string, i = 0) => DEVICE_COLOR[d.toLowerCase()] ?? C[i % C.length];
