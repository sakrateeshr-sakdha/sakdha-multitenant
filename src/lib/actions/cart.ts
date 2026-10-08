"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export type AddToBagResult =
  | { ok: true }
  | { ok: false; reason: "AUTH_REQUIRED" | "OUT_OF_STOCK" | "UNAVAILABLE" | "ERROR"; message: string };

/**
 * Adds a line to the signed-in customer's cart.
 *
 * Price is read from the database here, never accepted from the client — the
 * snapshot exists only to record what the customer was shown. Checkout
 * recomputes every number server-side regardless (P2), so a stale snapshot can
 * never become the charged amount.
 */
export async function addToBag(input: {
  productId: string;
  variantId?: string | null;
  qty: number;
}): Promise<AddToBagResult> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, reason: "AUTH_REQUIRED", message: "Sign in to add items to your bag." };
  }

  const qty = Math.min(10, Math.max(1, Math.trunc(input.qty)));

  // RLS already limits this to ACTIVE products; re-read price/seller/store so
  // the row we write is built entirely from server-side truth.
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, price, seller_id, store_id, status")
    .eq("id", input.productId)
    .maybeSingle();

  if (productError || !product) {
    return { ok: false, reason: "UNAVAILABLE", message: "This product is no longer available." };
  }
  const p = product as { price: number; seller_id: string; store_id: string; status: string };
  if (p.status !== "ACTIVE") {
    return { ok: false, reason: "UNAVAILABLE", message: "This product is no longer available." };
  }

  let unitPrice = p.price;

  if (input.variantId) {
    const { data: variant } = await supabase
      .from("product_variants")
      .select("id, price_override, inventory_qty, reserved_qty, is_active")
      .eq("id", input.variantId)
      .eq("product_id", input.productId)
      .maybeSingle();

    const v = variant as {
      price_override: number | null;
      inventory_qty: number;
      reserved_qty: number;
      is_active: boolean;
    } | null;

    if (!v || !v.is_active) {
      return { ok: false, reason: "UNAVAILABLE", message: "That option is no longer available." };
    }
    if (v.inventory_qty - v.reserved_qty < qty) {
      return { ok: false, reason: "OUT_OF_STOCK", message: "Not enough stock for that option." };
    }
    if (v.price_override != null) unitPrice = v.price_override;
  }

  // One open cart per customer.
  const { data: existingCart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", user.id)
    .maybeSingle();

  let cartId = (existingCart as { id: string } | null)?.id;
  if (!cartId) {
    const { data: created, error: cartError } = await supabase
      .from("carts")
      .insert({ customer_id: user.id })
      .select("id")
      .single();
    if (cartError || !created) {
      return { ok: false, reason: "ERROR", message: "Could not open a cart. Please try again." };
    }
    cartId = (created as { id: string }).id;
  }

  // Same product+variant already in the bag → bump the quantity.
  const { data: existingItem } = await supabase
    .from("cart_items")
    .select("id, qty")
    .eq("cart_id", cartId)
    .eq("product_id", input.productId)
    .is("variant_id", input.variantId ?? null)
    .maybeSingle();

  if (existingItem) {
    const item = existingItem as { id: string; qty: number };
    const { error } = await supabase
      .from("cart_items")
      .update({ qty: Math.min(10, item.qty + qty), unit_price_snapshot: unitPrice })
      .eq("id", item.id);
    if (error) return { ok: false, reason: "ERROR", message: "Could not update your bag." };
    return { ok: true };
  }

  const { error } = await supabase.from("cart_items").insert({
    cart_id: cartId,
    product_id: input.productId,
    variant_id: input.variantId ?? null,
    seller_id: p.seller_id,
    store_id: p.store_id,
    qty,
    unit_price_snapshot: unitPrice,
  });
  if (error) return { ok: false, reason: "ERROR", message: "Could not add this to your bag." };

  revalidatePath("/cart");
  return { ok: true };
}

/**
 * Change the quantity of a line. RLS scopes cart_items to the owning customer,
 * so a forged line id belonging to someone else simply matches no row.
 */
export async function updateCartQty(itemId: string, qty: number): Promise<AddToBagResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, reason: "AUTH_REQUIRED", message: "Sign in to manage your bag." };
  }

  const next = Math.min(10, Math.max(1, Math.trunc(qty)));

  const { data: item } = await supabase
    .from("cart_items")
    .select("id, product_id, variant_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok: false, reason: "UNAVAILABLE", message: "That item is no longer in your bag." };

  const line = item as { id: string; variant_id: string | null };

  // Never let the bag exceed what is actually on the shelf.
  if (line.variant_id) {
    const { data: variant } = await supabase
      .from("product_variants")
      .select("inventory_qty, reserved_qty")
      .eq("id", line.variant_id)
      .maybeSingle();
    const v = variant as { inventory_qty: number; reserved_qty: number } | null;
    if (v && v.inventory_qty - v.reserved_qty < next) {
      return { ok: false, reason: "OUT_OF_STOCK", message: "Not enough stock for that quantity." };
    }
  }

  const { error } = await supabase.from("cart_items").update({ qty: next }).eq("id", itemId);
  if (error) return { ok: false, reason: "ERROR", message: "Could not update your bag." };

  revalidatePath("/cart");
  return { ok: true };
}

export async function removeCartItem(itemId: string): Promise<AddToBagResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, reason: "AUTH_REQUIRED", message: "Sign in to manage your bag." };
  }

  const { error } = await supabase.from("cart_items").delete().eq("id", itemId);
  if (error) return { ok: false, reason: "ERROR", message: "Could not remove that item." };

  revalidatePath("/cart");
  return { ok: true };
}
