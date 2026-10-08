import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type { QuoteLine } from "@/lib/commerce/pricing";

/**
 * Cart reads. Every row is re-priced from the products/variants tables here —
 * cart_items.unit_price_snapshot records what the customer was *shown*, and is
 * deliberately never used as the charged amount.
 */

export type CartLine = {
  id: string;
  productId: string;
  variantId: string | null;
  sellerId: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  productSlug: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  optionLabel: string | null;
  qty: number;
  /** Live price from the database. */
  unitPrice: number;
  /** What was shown when the item was added, for a "price changed" notice. */
  snapshotPrice: number;
  lineTotal: number;
  categoryId: string | null;
  available: number | null;
  isAvailable: boolean;
  unavailableReason: string | null;
};

export type Cart = {
  id: string | null;
  lines: CartLine[];
  itemCount: number;
};

const CART_SELECT = `
  id, qty, unit_price_snapshot, variant_id,
  products:product_id (
    id, slug, name, price, status, seller_id, store_id, category_id,
    stores:store_id ( id, name, slug ),
    product_media ( url, position, type )
  ),
  product_variants:variant_id (
    id, sku, option_values_json, price_override, inventory_qty, reserved_qty, is_active
  )
`;

type RawCartRow = {
  id: string;
  qty: number;
  unit_price_snapshot: number;
  variant_id: string | null;
  products: {
    id: string;
    slug: string;
    name: string;
    price: number;
    status: string;
    seller_id: string;
    store_id: string;
    category_id: string | null;
    stores: { id: string; name: string; slug: string } | null;
    product_media: { url: string; position: number; type: string }[] | null;
  } | null;
  product_variants: {
    id: string;
    sku: string | null;
    option_values_json: Record<string, string>;
    price_override: number | null;
    inventory_qty: number;
    reserved_qty: number;
    is_active: boolean;
  } | null;
};

/** The signed-in customer's cart, re-priced and stock-checked. */
export async function getCart(): Promise<Cart> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, lines: [], itemCount: 0 };

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!cart) return { id: null, lines: [], itemCount: 0 };

  const cartId = (cart as { id: string }).id;
  const { data, error } = await supabase
    .from("cart_items")
    .select(CART_SELECT)
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getCart: ${error.message}`);

  const lines: CartLine[] = [];

  for (const row of (data ?? []) as unknown as RawCartRow[]) {
    const product = row.products;
    // RLS hides non-ACTIVE products from the customer, so a null join means
    // the product was archived or suspended after it was added.
    if (!product) {
      continue;
    }

    const variant = row.product_variants;
    const unitPrice = variant?.price_override ?? product.price;
    const available = variant ? variant.inventory_qty - variant.reserved_qty : null;

    let unavailableReason: string | null = null;
    if (product.status !== "ACTIVE") unavailableReason = "No longer available";
    else if (variant && !variant.is_active) unavailableReason = "This option was removed";
    else if (available != null && available <= 0) unavailableReason = "Out of stock";
    else if (available != null && available < row.qty) {
      unavailableReason = `Only ${available} left`;
    }

    const image = (product.product_media ?? [])
      .filter((m) => m.type === "image")
      .sort((a, b) => a.position - b.position)[0];

    const optionLabel = variant?.option_values_json
      ? Object.entries(variant.option_values_json)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : null;

    lines.push({
      id: row.id,
      productId: product.id,
      variantId: row.variant_id,
      sellerId: product.seller_id,
      storeId: product.store_id,
      storeName: product.stores?.name ?? "Store",
      storeSlug: product.stores?.slug ?? "",
      productSlug: product.slug,
      name: product.name,
      sku: variant?.sku ?? null,
      imageUrl: image?.url ?? null,
      optionLabel: optionLabel || null,
      qty: row.qty,
      unitPrice,
      snapshotPrice: row.unit_price_snapshot,
      lineTotal: unitPrice * row.qty,
      categoryId: product.category_id,
      available,
      isAvailable: unavailableReason === null,
      unavailableReason,
    });
  }

  return {
    id: cartId,
    lines,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
  };
}

/** Cart lines in the shape the pricing engine consumes. */
export function toQuoteLines(lines: CartLine[]): QuoteLine[] {
  return lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    sellerId: l.sellerId,
    storeId: l.storeId,
    name: l.name,
    sku: l.sku,
    qty: l.qty,
    unitPrice: l.unitPrice,
    categoryId: l.categoryId,
  }));
}

/** Lightweight count for the header badge. */
export async function getCartCount(): Promise<number> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!cart) return 0;

  const { data } = await supabase
    .from("cart_items")
    .select("qty")
    .eq("cart_id", (cart as { id: string }).id);

  return ((data ?? []) as { qty: number }[]).reduce((n, r) => n + r.qty, 0);
}
