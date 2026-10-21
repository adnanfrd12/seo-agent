import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // headless Chromium for server-side PDF export must not be bundled
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
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
