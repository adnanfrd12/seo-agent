/**
 * This deployment's public address for OAuth redirect URIs, callbacks and links. NEXT_PUBLIC_APP_URL, except that a
 * localhost value is never used on a Vercel deployment: there the project's production domain is used instead
 * (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel). Without either, "".
 */
export function appUrl(): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().replace(/\/+$/, "");
  if (vercel && (!env || /\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(env))) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return env;
}
