"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export type WishlistResult =
  | { ok: true; saved: boolean }
  | { ok: false; reason: "AUTH_REQUIRED" | "ERROR"; message: string };

/**
 * Adds or removes a product from the signed-in customer's wishlist.
 *
 * RLS scopes wishlist_items to customer_id = auth.uid(), and the table has a
 * unique (customer_id, product_id), so this cannot create duplicates even if
 * the button is double-clicked.
 */
export async function toggleWishlist(productId: string): Promise<WishlistResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, reason: "AUTH_REQUIRED", message: "Sign in to save items." };
  }

  const { data: existing } = await supabase
    .from("wishlist_items")
    .select("id")
    .eq("customer_id", user.id)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("wishlist_items")
      .delete()
      .eq("id", (existing as { id: string }).id);
    if (error) return { ok: false, reason: "ERROR", message: "Could not update your wishlist." };
    revalidatePath("/wishlist");
    return { ok: true, saved: false };
  }

  const { error } = await supabase
    .from("wishlist_items")
    .insert({ customer_id: user.id, product_id: productId });
  if (error) return { ok: false, reason: "ERROR", message: "Could not save this item." };

  revalidatePath("/wishlist");
  return { ok: true, saved: true };
}
