/** Categorical colour for entity slot i (fixed order, never cycled): slots past eight fold into "Other". */
export const cat = (i: number) => (i >= 0 && i < 8 ? `var(--cat-${i + 1})` : "var(--cat-other)");
