import type { IntegrationCategory } from "@/lib/org/registry";

/**
 * What the Integrations tab's client components receive about an organization's integrations. Built on the
 * server (org-data.ts). Values are never included: owners get masked hints (••••1234) and non-secret values
 * such as client IDs; admins get status only (display is null).
 */
export type CredentialStatus = "configured" | "partial" | "missing" | "connected" | "not_connected";

export interface FieldView {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** a value is available (saved here, or read from the server environment) */
  set: boolean;
  source: "org" | "env" | null;
  /** owners only: masked hint for secrets, the value for non-secret fields */
  display: string | null;
}

export interface IntegrationView {
  id: string;
  name: string;
  category: IntegrationCategory;
  categoryLabel: string;
  description: string;
  features: string[];
  fields: FieldView[];
  status: CredentialStatus;
  statusLabel: string;
  /** labels of required fields that are still empty */
  missing: string[];
  /** some value is read from the server environment (first organization, until imported) */
  fromEnv: boolean;
  /** values saved in this organization (what Delete removes) */
  stored: number;
  /** after Delete, the server environment would supply values again (first organization, until imported) */
  envBackup: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** "Nov 27, 2026 by Waheed Hussain", in the organization's time zone */
  updated: string | null;
  consoleUrl?: string;
  docsUrl?: string;
  /** full OAuth redirect URI on this deployment */
  redirectUri?: string;
  /** connected per client instead of by organization credentials */
  perClient?: string;
  connectedClients?: number;
  testable: boolean;
  /** what currently relies on it (shown before Delete) */
  inUse: string[];
  /** lower-case text the search box matches */
  search: string;
}

export interface CustomVarView {
  key: string;
  secret: boolean;
  /** owners only */
  display: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updated: string | null;
}

/** The status filter's three groups (connected counts as configured, not connected as not configured). */
export type FilterStatus = "configured" | "partial" | "missing";
export const filterStatusOf = (s: CredentialStatus): FilterStatus =>
  s === "configured" || s === "connected" ? "configured" : s === "partial" ? "partial" : "missing";

/** An item the search box, category chips and status filter can hide. */
export interface FilterItem {
  category: IntegrationCategory | null;
  search: string;
  /** null: not an integration (freshness, scheduled jobs), hidden while a status is picked */
  status?: FilterStatus | null;
}
