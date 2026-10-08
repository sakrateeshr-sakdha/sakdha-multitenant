import { sitemapIndexXml, xmlResponse } from "@/lib/sitemap";

export const revalidate = 3600;

/** Sitemap index — split by entity type so each stays well under 50k URLs. */
export function GET() {
  return xmlResponse(
    sitemapIndexXml([
      "/pages-sitemap.xml",
      "/category-sitemap.xml",
      "/store-sitemap.xml",
      "/product-sitemap.xml",
    ])
  );
}
