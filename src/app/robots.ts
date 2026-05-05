import type { MetadataRoute } from "next";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";

/**
 * Crawler rules. Marketing surfaces (`/`, `/sign-in`, `/sign-up`) are
 * indexable; everything authenticated, internal, or transactional is
 * blocked from indexing so Google doesn't waste crawl budget on
 * non-public routes (and so leaked invite tokens never end up in SERP).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/clients",
          "/clients/",
          "/deadlines",
          "/deadlines/",
          "/announcements",
          "/announcements/",
          "/settings",
          "/settings/",
          "/invite/",
          "/.well-known/",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
