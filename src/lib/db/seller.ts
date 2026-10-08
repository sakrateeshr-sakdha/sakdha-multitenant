import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type { CategoryOption } from "@/components/seller/ProductForm";

/** Flat category list with parent names, for the product form's select. */
export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("categories")
    .select("id, name, parent_id, position")
    .order("position", { ascending: true });

  const rows = (data ?? []) as { id: string; name: string; parent_id: string | null }[];
  const nameById = new Map(rows.map((c) => [c.id, c.name]));

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    parentName: c.parent_id ? (nameById.get(c.parent_id) ?? null) : null,
  }));
}
