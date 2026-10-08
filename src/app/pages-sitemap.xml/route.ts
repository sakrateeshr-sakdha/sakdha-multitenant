import { urlSetXml, xmlResponse } from "@/lib/sitemap";

export const revalidate = 86400;

/**
 * Static, evergreen pages. Cart/checkout/account/search are deliberately
 * absent — they are disallowed in robots.txt and must never be indexed.
 */
export function GET() {
  return xmlResponse(
    urlSetXml([
      { path: "/", changeFrequency: "daily", priority: 1.0 },
      { path: "/stores", changeFrequency: "daily", priority: 0.9 },
    ])
  );
}
