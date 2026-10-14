import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
