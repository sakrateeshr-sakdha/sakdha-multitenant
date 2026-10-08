import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { quoteCart } from "@/lib/commerce/quote";

export const dynamic = "force-dynamic";

/**
 * Re-prices the signed-in customer's cart. Read-only: it creates nothing and
 * charges nothing. Useful for a cart badge, an address-change re-quote, or any
 * client that needs the authoritative totals without starting a payment.
 *
 * Commission is intentionally NOT exposed — it is between Sakdha and the
 * seller, not something the customer needs or should see.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { cart, quote } = await quoteCart();

  return NextResponse.json({
    itemCount: cart.itemCount,
    shipmentCount: quote.shipmentCount,
    subtotal: quote.subtotal,
    discountTotal: quote.discountTotal,
    shippingTotal: quote.shippingTotal,
    taxTotal: quote.taxTotal,
    grandTotal: quote.grandTotal,
    unavailable: cart.lines
      .filter((l) => !l.isAvailable)
      .map((l) => ({ id: l.id, name: l.name, reason: l.unavailableReason })),
    sellers: quote.sellers.map((s) => ({
      storeName: s.storeName,
      storeSlug: s.storeSlug,
      subtotal: s.subtotal,
      shipping: s.shipping,
      dispatchSlaHours: s.dispatchSlaHours,
      freeShippingShortfall: s.freeShippingShortfall,
      items: s.lines.map((l) => ({ name: l.name, qty: l.qty, lineTotal: l.lineTotal })),
    })),
  });
}
