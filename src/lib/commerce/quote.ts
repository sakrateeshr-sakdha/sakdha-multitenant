import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCart, toQuoteLines, type Cart } from "@/lib/db/cart";
import {
  buildQuote,
  type CommissionRule,
  type Quote,
  type ShippingRule,
} from "@/lib/commerce/pricing";

/**
 * Loads the cart and prices it. This is the only path that produces the
 * numbers shown at /cart and /checkout and the numbers written to the orders
 * table, so the customer can never be shown one total and charged another.
 */
export async function quoteCart(): Promise<{ cart: Cart; quote: Quote }> {
  const cart = await getCart();

  // Unavailable lines are excluded from the quote — they are still displayed,
  // but they cannot be bought and must not inflate the total.
  const sellable = cart.lines.filter((l) => l.isAvailable);
  if (sellable.length === 0) {
    return {
      cart,
      quote: {
        sellers: [],
        subtotal: 0,
        discountTotal: 0,
        shippingTotal: 0,
        taxTotal: 0,
        commissionTotal: 0,
        grandTotal: 0,
        shipmentCount: 0,
      },
    };
  }

  const supabase = await createServerSupabase();
  const sellerIds = [...new Set(sellable.map((l) => l.sellerId))];
  const storeIds = [...new Set(sellable.map((l) => l.storeId))];

  const [storesResult, shippingResult, commissionResult] = await Promise.all([
    supabase.from("stores").select("id, name, slug").in("id", storeIds),
    supabase
      .from("shipping_rules")
      .select("seller_id, type, flat_fee, free_above_threshold, dispatch_sla_hours")
      .in("seller_id", sellerIds),
    supabase
      .from("commission_rules")
      .select(
        "id, percentage, fixed_amount, applies_to, category_id, seller_id, active, valid_from, valid_until"
      )
      .eq("active", true),
  ]);

  if (storesResult.error) throw new Error(`quoteCart stores: ${storesResult.error.message}`);
  if (shippingResult.error) throw new Error(`quoteCart shipping: ${shippingResult.error.message}`);
  if (commissionResult.error) {
    throw new Error(`quoteCart commission: ${commissionResult.error.message}`);
  }

  const stores = new Map(
    ((storesResult.data ?? []) as { id: string; name: string; slug: string }[]).map((s) => [
      s.id,
      { name: s.name, slug: s.slug },
    ])
  );

  const shippingRules = new Map(
    ((shippingResult.data ?? []) as ShippingRule[]).map((r) => [r.seller_id, r])
  );

  const quote = buildQuote(toQuoteLines(sellable), {
    stores,
    shippingRules,
    commissionRules: ((commissionResult.data ?? []) as CommissionRule[]).map((r) => ({
      ...r,
      percentage: Number(r.percentage),
    })),
  });

  return { cart, quote };
}
