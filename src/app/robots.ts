import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/cart",
          "/checkout",
          "/account",
          "/wishlist",
          "/seller/",
          "/admin/",
          "/login",
          "/signup",
          "/search", // internal search results
          "/*?*min=", // filter permutations — crawl budget goes to clean URLs
          "/*?*max=",
          "/*?*gender=",
          "/*?*fabric=",
          "/*?*occasion=",
          "/*?*sort=",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
