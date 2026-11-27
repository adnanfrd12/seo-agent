/** Display names shared by the organization settings, the invitation page and invitation emails (no server code). */
export type OrgRoleId = "owner" | "admin" | "member" | "viewer";
export type ClientRoleId = "owner" | "admin" | "viewer";

export const ROLE_LABEL: Record<OrgRoleId, string> = { owner: "Owner", admin: "Admin", member: "Team member", viewer: "Client / viewer" };
export const ROLE_HINT: Record<OrgRoleId, string> = {
  owner: "Everything, including integration credentials and other owners.",
  admin: "Settings, branding, members, clients and client access. Not credentials.",
  member: "Works in the clients they're given (edit or view per client).",
  viewer: "Views the clients they're given. Can't change anything.",
};
export const CLIENT_ROLE_LABEL: Record<ClientRoleId, string> = { owner: "Client owner", admin: "Can edit", viewer: "View only" };

export const DATE_RANGES = [7, 30, 90] as const;
export const WEEK_STARTS = [{ id: "monday", label: "Monday" }, { id: "sunday", label: "Sunday" }, { id: "saturday", label: "Saturday" }] as const;

export const LANGUAGES = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["it", "Italian"], ["nl", "Dutch"],
  ["ar", "Arabic"], ["ur", "Urdu"], ["hi", "Hindi"], ["tr", "Turkish"], ["zh", "Chinese"], ["ja", "Japanese"],
] as const;
export const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "AED", "SAR", "QAR", "PKR", "INR", "BDT", "SGD", "HKD", "JPY", "CNY", "CHF",
  "SEK", "NOK", "DKK", "PLN", "TRY", "ZAR", "BRL", "MXN",
] as const;

export const PROVIDER_LABEL: Record<string, string> = {
  ga4: "GA4", gsc: "Search Console", gbp: "Business Profile", clarity: "Clarity", lbm: "Local Brand Manager", bing: "Bing",
};

/**
 * Invitations by email link are kept but hidden for now: owners and team members are added directly with an email
 * and password (Settings → Platform, Settings → Organization → Team members). Set to true to show invitations again.
 */
export const INVITATIONS_ENABLED = false;
