/** Markets offered for Google rankings and keyword data (DataForSEO location + language codes). */
export const MARKETS = [
  { code: 2840, lang: "en", label: "United States" },
  { code: 2826, lang: "en", label: "United Kingdom" },
  { code: 2124, lang: "en", label: "Canada (English)" },
  { code: 2036, lang: "en", label: "Australia" },
  { code: 2554, lang: "en", label: "New Zealand" },
  { code: 2372, lang: "en", label: "Ireland" },
  { code: 2356, lang: "en", label: "India" },
  { code: 2586, lang: "en", label: "Pakistan" },
  { code: 2608, lang: "en", label: "Philippines" },
  { code: 2702, lang: "en", label: "Singapore" },
  { code: 2784, lang: "en", label: "United Arab Emirates" },
  { code: 2710, lang: "en", label: "South Africa" },
  { code: 2276, lang: "de", label: "Germany" },
  { code: 2250, lang: "fr", label: "France" },
  { code: 2724, lang: "es", label: "Spain" },
  { code: 2484, lang: "es", label: "Mexico" },
] as const;

export const marketLabel = (code: number) => MARKETS.find((m) => m.code === code)?.label ?? `Location ${code}`;
export const marketByCode = (code: number) => MARKETS.find((m) => m.code === code);
