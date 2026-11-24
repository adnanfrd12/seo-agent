import type { MetadataRoute } from "next";
import { SITE } from "@/config/platforms";

const PUBLIC = ["/", "/login", "/privacy", "/terms", "/data-deletion", "/data-deletion/status", "/platforms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-11-23T00:00:00Z");
  return PUBLIC.map((p) => ({ url: `${SITE.appUrl}${p === "/" ? "" : p}`, lastModified }));
}
