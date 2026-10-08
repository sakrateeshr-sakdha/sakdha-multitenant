import { createServerSupabase } from "@/lib/supabase/server";
import { urlSetXml, xmlResponse } from "@/lib/sitemap";

export const revalidate = 3600;

/**
 * Only ACTIVE products belonging to an indexable store. RLS already hides
 * non-ACTIVE rows from anon traffic; the explicit filter keeps intent obvious
 * and survives any future policy change.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("slug, updated_at, stores:store_id!inner ( is_indexable )")
    .eq("status", "ACTIVE")
    .eq("stores.is_indexable", true)
    .order("updated_at", { ascending: false })
    .limit(45000);

  if (error) return xmlResponse(urlSetXml([]));

  const rows = (data ?? []) as unknown as { slug: string; updated_at: string }[];
  return xmlResponse(
    urlSetXml(
      rows.map((row) => ({
        path: `/product/${row.slug}`,
        lastModified: row.updated_at,
        changeFrequency: "weekly",
        priority: 0.8,
      }))
    )
  );
}
