import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // headless Chromium for server-side PDF export must not be bundled
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // @sparticuz/chromium loads its compressed browser from bin/ at runtime; file tracing can't see
  // that dynamic path, so include it explicitly for the PDF function.
  outputFileTracingIncludes: { "/api/report/pdf": ["./node_modules/@sparticuz/chromium/bin/**"] },
  // Every page is per-user and reads auth cookies, so Cache Components /
  // partial prefetching (enabled by the scaffold) are intentionally off.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
