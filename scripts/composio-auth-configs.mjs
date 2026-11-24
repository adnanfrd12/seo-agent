// Read-only: lists Composio auth configs (toolkit, managed vs own app, scopes, redirect). No secrets printed.
// Run: node --env-file=.env scripts/composio-auth-configs.mjs
import { Composio } from "@composio/core";
const c = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const list = await c.authConfigs.list({ limit: 100 });
for (const a of list.items) {
  const full = await c.authConfigs.get(a.id).catch(() => a);
  const creds = full.credentials ?? {};
  console.log(JSON.stringify({
    id: a.id, toolkit: a.toolkit?.slug, status: a.status, managed: full.isComposioManaged ?? full.is_composio_managed,
    authScheme: full.authScheme ?? full.auth_scheme, scopes: creds.scopes ?? creds.scope ?? full.scopes ?? null,
    redirect: creds.redirect_uri ?? creds.oauth_redirect_uri ?? null, keys: Object.keys(creds),
  }));
}
