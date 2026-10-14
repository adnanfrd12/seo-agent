export type Provider = "ga4" | "gsc" | "gbp";

/** Shape shared by every provider adapter (Composio-backed or direct). */
export interface ProviderAdapter<TResource> {
  provider: Provider;
  listResources(ctx: AdapterContext): Promise<TResource[]>;
}

export interface AdapterContext {
  userId: string;
  connectedAccountId: string;
}

export interface DiscoveredResource {
  externalId: string;
  displayName: string;
  timezone?: string;
  metadata?: Record<string, unknown>;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;
}
