// Generates docs/platform-console-values.md from the platform registry (src/config/platforms.ts).
// Run: npx tsx --tsconfig tests/tsconfig.test.json scripts/gen-console-values.mts
import { writeFileSync } from "node:fs";
import { COMPOSIO_REDIRECTS, publicPlatforms, SITE, type PlatformEntry } from "@/config/platforms";

const u = (path: string) => `${SITE.appUrl}${path}`;
const L: string[] = [];
const out = (s = "") => L.push(s);

const CREDS: Record<string, string> = {
  google_search_console: "Google OAuth Client ID → Composio \"Client id\"; Client secret → \"Client secret\" (Composio toolkit google_search_console, auth config type: custom / your own app).",
  google_analytics: "Google OAuth Client ID → Composio \"Client id\"; Client secret → \"Client secret\" (toolkit google_analytics).",
  youtube: "Google OAuth Client ID → Composio \"Client id\"; Client secret → \"Client secret\" (toolkit youtube).",
  facebook_pages: "Meta App ID → Composio \"Client id\"; Meta App Secret → \"Client secret\" (toolkit facebook). The same App Secret goes in META_APP_SECRET.",
  instagram: "Instagram App ID (Instagram API with Instagram Login) → Composio \"Client id\"; Instagram App Secret → \"Client secret\" (toolkit instagram). The same secret goes in INSTAGRAM_APP_SECRET.",
  threads: "Threads App ID → Composio \"Client id\"; Threads App Secret → \"Client secret\" (toolkit threads). The same secret goes in THREADS_APP_SECRET.",
  x: "X OAuth 2.0 Client ID → Composio \"Client id\"; OAuth 2.0 Client Secret → \"Client secret\" (toolkit twitter). Put the auth config id in COMPOSIO_AUTH_CONFIG_TWITTER (optional).",
  tiktok: "TikTok Client Key → Composio \"Client id\"; Client Secret → \"Client secret\" (toolkit tiktok). The same secret goes in TIKTOK_CLIENT_SECRET.",
  pinterest: "Pinterest App ID → Composio \"Client id\"; App secret key → \"Client secret\" (toolkit pinterest).",
  linkedin: "LinkedIn Client ID → Composio \"Client id\"; Client Secret → \"Client secret\" (toolkit linkedin).",
};

const NOTES: Record<string, string[]> = {
  Google: [
    "OAuth consent screen: App name SEO Insights; user support and developer contact im@waheedzen.com; logo; App home page, Privacy policy and Terms links below.",
    "Authorized domain: waheedzen.com (verify it in Google Search Console under the same Google account).",
    "Scopes: list exactly the scopes below. Demo video: sign in at the homepage, open Integrations, show the consent panel, connect, and show each scope's data in use (Search Console pages, Analytics pages, Business Profile page, Social → YouTube).",
  ],
  Meta: [
    "App Dashboard → Settings → Basic: Display name SEO Insights, App domains waheedzen.com, Privacy Policy URL, Terms of Service URL, User data deletion → Data deletion callback URL (below), category Business, contact email im@waheedzen.com.",
    "Use cases: add only the permissions below; complete Data Use Checkup; App Review needs a screencast of the Connect flow and a reviewer test login (see Reviewer test account).",
    "Business verification: Waheed Zen LLC (already verified).",
  ],
  "X Corp.": ["User authentication settings: App permissions Read; Type of App Web App, Automated App or Bot; Callback URI / Redirect URL = each Composio URL below; Website URL = homepage; Terms of service and Privacy policy URLs below."],
  TikTok: ["Platform: Web. Verify the domain seoinsights.waheedzen.com (URL prefix) in the TikTok developer portal. Login Kit: Redirect URI = each Composio URL below. Webhooks: Callback URL below. Demo video recorded on the verified domain showing Connect and the TikTok stats."],
  Pinterest: ["Redirect URIs = each Composio URL below. Start in Trial access, then request Standard access with a demo video of Connect and the Pinterest stats."],
  LinkedIn: ["Products: Community Management API (read). Auth → Authorized redirect URLs = each Composio URL below. Privacy policy URL below."],
  Microsoft: ["No developer console: the site owner creates the key/token and pastes it into Integrations. Nothing to register."],
};

out("# Platform console values");
out();
out(`Generated from \`src/config/platforms.ts\` by \`scripts/gen-console-values.mts\`. Do not edit by hand; edit the registry and re-run.`);
out();
out("## Values for every console");
out();
out("| Field | Value |");
out("|---|---|");
out(`| App name / display name | **${SITE.product}** (also Meta's "Threads Display Name") |`);
out(`| Company | ${SITE.operator} |`);
out(`| Contact email | ${SITE.email} |`);
out(`| Website / homepage | ${SITE.appUrl} |`);
out(`| App domain (Meta) / verified domain (Google authorized domain, TikTok, Pinterest) | ${SITE.appDomain} (TikTok and Pinterest: verify seoinsights.waheedzen.com) |`);
out(`| Privacy policy URL | ${u("/privacy")} |`);
out(`| Terms URL | ${u("/terms")} |`);
out(`| Data deletion URL (instructions) | ${u("/data-deletion")} |`);
out(`| Permissions page | ${u("/platforms")} |`);
out();
out("### Composio OAuth redirect URLs");
out();
out("Add **every** URL below to the redirect / callback allow-list of each Composio-connected platform. The live auth configs currently use the first one; Composio's current docs show the second; the third is the newer API version.");
out();
for (const r of COMPOSIO_REDIRECTS) out(`- \`${r}\``);
out();
out("Deauthorize, delete, uninstall and webhook URLs must point to **SEO Insights**, never to Composio.");
out();

const byProvider = new Map<string, PlatformEntry[]>();
for (const p of publicPlatforms()) byProvider.set(p.provider, [...(byProvider.get(p.provider) ?? []), p]);

for (const [provider, list] of byProvider) {
  out(`## ${provider}`);
  out();
  for (const n of NOTES[provider] ?? []) out(`- ${n}`);
  out();
  for (const p of list) {
    out(`### ${p.name} (\`${p.id}\`, ${p.status === "live" ? "live" : "in review"})`);
    out();
    out(`- Connection: ${p.method}`);
    if (p.connection === "composio") out(`- Redirect URIs: ${COMPOSIO_REDIRECTS.map((r) => `\`${r}\``).join(", ")}`);
    if (p.id === "google_business_profile") out(`- Redirect URI (our own OAuth callback): \`${u("/api/integrations/gbp/callback")}\``);
    if (p.id === "google_signin") out("- Redirect URI: `https://<supabase-project-ref>.supabase.co/auth/v1/callback` (Supabase Auth → Google provider)");
    if (CREDS[p.id]) out(`- Composio auth config: ${CREDS[p.id]}`);
    for (const w of p.webhooks ?? []) out(`- ${w.label}: \`${u(w.path)}\``);
    out(`- Console notes: ${p.consoleNotes}`);
    out("- Scopes to request (reviewer justification):");
    for (const s of p.scopes) out(`  - \`${s.scope}\`: ${s.reason}`);
    if (p.scopeNote) out(`- **Flag:** ${p.scopeNote}`);
    out(`- Revoke steps shown to users: ${p.revokeSteps.join(" ")}`);
    out();
  }
}

out("## Reviewer test account");
out();
out("1. In Supabase Auth, create a user for the reviewer (email `reviewer@waheedzen.com` or the address the platform asks for). Do not commit the password; store it in the password manager and paste it only into the review form.");
out("2. Create a demo workspace (client) named \"SEO Insights Demo\" and add the reviewer as a member with role `admin`, so the Integrations and Social pages show Connect and Disconnect.");
out("3. Connect a demo Search Console property, GA4 property and the social test accounts the platform provides (Meta and TikTok give test users), so every screen shows sample data.");
out("4. Fill in for each review:");
out();
out("| Field | Value |");
out("|---|---|");
out("| Login URL | https://seoinsights.waheedzen.com/login |");
out("| Username | `<REVIEWER_EMAIL>` |");
out("| Password | `<REVIEWER_PASSWORD>` (from the password manager; never committed) |");
out("| Steps | Sign in → Integrations or Social media → Connect → read the consent panel → Continue → approve → see the data → Disconnect |");
out();

writeFileSync(new URL("../docs/platform-console-values.md", import.meta.url), L.join("\n"));
console.log(`docs/platform-console-values.md written (${publicPlatforms().length} platforms)`);
