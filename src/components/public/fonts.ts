import { Instrument_Sans, Instrument_Serif } from "next/font/google";

/** Typefaces for the public landing and sign-in pages only (the dashboard keeps Geist). */
export const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
export const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-public-serif", display: "swap" });

export const publicFonts = `${sans.variable} ${serif.variable}`;
