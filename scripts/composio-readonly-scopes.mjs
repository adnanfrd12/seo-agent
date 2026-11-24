// Narrows the existing Composio auth configs to the read-only scopes in src/config/platforms.ts.
// NOT run automatically: it changes live consent screens. Existing connections keep their old grant until
// they reconnect. Composio-managed configs may reject custom scopes; the script reports each result.
//
//   node --env-file=.env scripts/composio-readonly-scopes.mjs           (dry run: shows what would change)
//   node --env-file=.env scripts/composio-readonly-scopes.mjs --apply   (updates the configs)
import { Composio } from "@composio/core";

const READ_ONLY = {
  google_analytics: ["https://www.googleapis.com/auth/analytics.readonly"],
  google_search_console: ["https://www.googleapis.com/auth/webmasters.readonly"],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"],
  facebook: ["public_profile", "pages_show_list", "pages_read_engagement", "read_insights"],
  instagram: ["instagram_business_basic", "instagram_business_manage_insights"],
  threads: ["threads_basic", "threads_manage_insights"],
  pinterest: ["user_accounts:read", "boards:read", "pins:read"],
  linkedin: ["r_organization_admin", "r_organization_social"],
  twitter: ["tweet.read", "users.read", "follows.read", "offline.access"],
  tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
};
const apply = process.argv.includes("--apply");
const c = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const list = await c.authConfigs.list({ limit: 100 });
for (const a of list.items) {
  const want = READ_ONLY[a.toolkit?.slug];
  if (!want) continue;
  const full = await c.authConfigs.get(a.id);
  const have = [].concat(full.credentials?.scopes ?? []).flatMap((s) => String(s).split(/[ ,]+/)).filter(Boolean);
  const extra = have.filter((s) => !want.includes(s));
  const missing = want.filter((s) => !have.includes(s));
  console.log(`${a.toolkit.slug} (${a.id}, ${full.isComposioManaged ? "Composio-managed" : "own app"}): remove [${extra.join(", ")}] add [${missing.join(", ")}]`);
  if (!apply || (!extra.length && !missing.length)) continue;
  try {
    await c.authConfigs.update(a.id, { type: "default", scopes: want.join(" ") });
    console.log("  updated");
  } catch (e) {
    console.log(`  NOT updated: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}
