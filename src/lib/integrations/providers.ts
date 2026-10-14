import { z } from "zod";

export const providerSchema = z.enum(["ga4", "gsc", "gbp"]);
export type ProviderId = z.infer<typeof providerSchema>;

export const PROVIDER_META: Record<
  ProviderId,
  { label: string; resourceNoun: string; viaComposio: boolean }
> = {
  ga4: { label: "Google Analytics 4", resourceNoun: "property", viaComposio: true },
  gsc: { label: "Google Search Console", resourceNoun: "site", viaComposio: true },
  // Composio has no Business Profile toolkit; needs the direct adapter + Google API approval.
  gbp: { label: "Google Business Profile", resourceNoun: "location", viaComposio: false },
};
