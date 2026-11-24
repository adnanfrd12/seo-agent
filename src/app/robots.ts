import type { MetadataRoute } from "next";
import { SITE } from "@/config/platforms";

/** Public pages are indexable; the signed-in app and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/login", "/privacy", "/terms", "/data-deletion", "/platforms"], disallow: ["/api/", "/overview", "/report", "/auth/"] }],
    sitemap: `${SITE.appUrl}/sitemap.xml`,
  };
}
