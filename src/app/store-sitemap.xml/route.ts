import { createServerSupabase } from "@/lib/supabase/server";
import { urlSetXml, xmlResponse } from "@/lib/sitemap";

export const revalidate = 3600;

/** Indexable stores that actually have products — no thin pages in the index. */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("stores")
    .select("slug, city, created_at")
    .eq("is_indexable", true)
    .gt("product_count", 0)
    .limit(45000);

  if (error) return xmlResponse(urlSetXml([]));

  const rows = (data ?? []) as { slug: string; city: string | null; created_at: string }[];

  const storeEntries = rows.map((row) => ({
    path: `/store/${row.slug}`,
    lastModified: row.created_at,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // City hubs ride along here — they are generated from the same store set.
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean) as string[])];
  const cityEntries = cities.map((city) => ({
    path: `/city/${encodeURIComponent(city.toLowerCase())}/stores`,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return xmlResponse(urlSetXml([...storeEntries, ...cityEntries]));
}
