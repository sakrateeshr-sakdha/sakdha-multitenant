import { createServerSupabase } from "@/lib/supabase/server";
import { urlSetXml, xmlResponse } from "@/lib/sitemap";

export const revalidate = 3600;

/**
 * Categories are emitted at their canonical depth: a child is listed as
 * /category/<parent>/<child>, matching the route that serves it.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("categories")
    .select("id, slug, parent_id, position")
    .eq("is_indexable", true)
    .order("position", { ascending: true });

  if (error) return xmlResponse(urlSetXml([]));

  const rows = (data ?? []) as {
    id: string;
    slug: string;
    parent_id: string | null;
    position: number;
  }[];
  const slugById = new Map(rows.map((r) => [r.id, r.slug]));

  const entries = rows.flatMap((row) => {
    if (!row.parent_id) {
      return [{ path: `/category/${row.slug}`, changeFrequency: "daily" as const, priority: 0.9 }];
    }
    const parentSlug = slugById.get(row.parent_id);
    // A child whose parent is not indexable has no canonical URL to offer.
    if (!parentSlug) return [];
    return [
      {
        path: `/category/${parentSlug}/${row.slug}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      },
    ];
  });

  return xmlResponse(urlSetXml(entries));
}
