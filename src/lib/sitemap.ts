import { absoluteUrl } from "@/lib/seo";

export type SitemapEntry = {
  path: string;
  lastModified?: string | null;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function urlSetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(absoluteUrl(entry.path))}</loc>`];
      if (entry.lastModified) {
        parts.push(`    <lastmod>${new Date(entry.lastModified).toISOString()}</lastmod>`);
      }
      if (entry.changeFrequency) {
        parts.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      }
      if (entry.priority != null) {
        parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function sitemapIndexXml(paths: string[]): string {
  const items = paths
    .map(
      (path) =>
        `  <sitemap>\n    <loc>${escapeXml(absoluteUrl(path))}</loc>\n  </sitemap>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

export const xmlResponse = (body: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
