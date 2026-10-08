import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { quoteCart } from "@/lib/commerce/quote";
import { assertQuoteBalances } from "@/lib/commerce/pricing";
import {
  createRouteOrder,
  isRazorpayConfigured,
  isUnsplitCheckoutAllowed,
  RazorpayApiError,
  type RouteTransfer,
} from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";

const AddressSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(8).max(20),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),
});

const BodySchema = z.object({ address: AddressSchema });

/**
 * Creates the order and the Razorpay Route order.
 *
 * Order of operations matters: stock is reserved BEFORE the payment order is
 * created, so a customer cannot pay for something another customer just took.
 * If anything downstream fails, the reservation is released.
 *
 * The client sends only an address. Every amount comes from quoteCart().
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to place an order." }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid delivery address.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { address } = parsed.data;

  if (!isRazorpayConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet. Add Razorpay keys to continue." },
      { status: 503 }
    );
  }

  // 1. Price the cart server-side.
  const { cart, quote } = await quoteCart();
  if (quote.sellers.length === 0) {
    return NextResponse.json({ error: "Your bag is empty." }, { status: 400 });
  }
  if (cart.lines.some((l) => !l.isAvailable)) {
    return NextResponse.json(
      { error: "Some items are no longer available. Review your bag." },
      { status: 409 }
    );
  }
  assertQuoteBalances(quote);

  // 2. Every seller must have a Route linked account, or their money has
  //    nowhere to land. Blocking here is deliberate (spec §10).
  const { data: sellerRows, error: sellerError } = await supabaseAdmin
    .from("sellers")
    .select("id, display_name, legal_name, status, razorpay_account_id")
    .in(
      "id",
      quote.sellers.map((s) => s.sellerId)
    );
  if (sellerError) {
    return NextResponse.json({ error: "Could not verify sellers." }, { status: 500 });
  }

  const sellersById = new Map(
    ((sellerRows ?? []) as {
      id: string;
      display_name: string | null;
      legal_name: string;
      status: string;
      razorpay_account_id: string | null;
    }[]).map((s) => [s.id, s])
  );

  const unsplitAllowed = isUnsplitCheckoutAllowed();

  // A suspended or unapproved seller is blocked regardless of payout mode.
  const notApproved = quote.sellers.filter(
    (s) => sellersById.get(s.sellerId)?.status !== "ACTIVE"
  );
  // Missing linked account is normally fatal; the test escape hatch waives it.
  const notPayable = quote.sellers.filter(
    (s) => !sellersById.get(s.sellerId)?.razorpay_account_id
  );

  const blocked = unsplitAllowed ? notApproved : [...new Set([...notApproved, ...notPayable])];
  if (blocked.length > 0) {
    return NextResponse.json(
      {
        error: "Some stores in your bag cannot accept orders yet.",
        stores: blocked.map((s) => s.storeName),
      },
      { status: 409 }
    );
  }

  // Splits happen only when EVERY seller can receive one; a partial split would
  // pay some sellers automatically and leave others silently unpaid.
  const useSplitPayments = notPayable.length === 0;

  // 3. Reserve stock atomically. Fails loudly rather than overselling.
  const reservationItems = quote.sellers.flatMap((s) =>
    s.lines
      .filter((l) => l.variantId)
      .map((l) => ({ variant_id: l.variantId, qty: l.qty }))
  );

  if (reservationItems.length > 0) {
    const { error } = await supabaseAdmin.rpc("reserve_inventory", {
      p_items: reservationItems,
    });
    if (error) {
      const outOfStock = error.message?.includes("INSUFFICIENT_STOCK");
      return NextResponse.json(
        {
          error: outOfStock
            ? "Someone just bought the last one. Review your bag."
            : "Could not reserve stock.",
        },
        { status: outOfStock ? 409 : 500 }
      );
    }
  }

  const releaseReservation = async () => {
    if (reservationItems.length > 0) {
      await supabaseAdmin.rpc("release_inventory", { p_items: reservationItems });
    }
  };

  let orderId: string | null = null;
  const transfers: RouteTransfer[] = [];

  try {
    // 4. Parent order + per-seller child orders. Written with the service role
    //    because orders are financial records: RLS grants customers read only.
    const { data: orderNumberResult, error: numberError } =
      await supabaseAdmin.rpc("next_order_number");
    if (numberError) throw new Error(`order number: ${numberError.message}`);
    const orderNumber = orderNumberResult as unknown as string;

    const { data: orderRow, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_id: user.id,
        subtotal: quote.subtotal,
        discount_total: quote.discountTotal,
        shipping_total: quote.shippingTotal,
        tax_total: quote.taxTotal,
        commission_total: quote.commissionTotal,
        grand_total: quote.grandTotal,
        payment_status: "PENDING_PAYMENT",
        order_status: "PENDING_PAYMENT",
        shipping_address_json: address,
      })
      .select("id, order_number")
      .single();
    if (orderError || !orderRow) throw new Error(`order insert: ${orderError?.message}`);
    orderId = (orderRow as { id: string }).id;

    for (const sellerQuote of quote.sellers) {
      const seller = sellersById.get(sellerQuote.sellerId)!;
      const dispatchDeadline = new Date(
        Date.now() + sellerQuote.dispatchSlaHours * 3600 * 1000
      ).toISOString();

      const { data: sellerOrder, error: sellerOrderError } = await supabaseAdmin
        .from("seller_orders")
        .insert({
          order_id: orderId,
          seller_id: sellerQuote.sellerId,
          store_id: sellerQuote.storeId,
          subtotal: sellerQuote.subtotal,
          discount: sellerQuote.discount,
          shipping: sellerQuote.shipping,
          tax: sellerQuote.tax,
          commission: sellerQuote.commission,
          seller_payable: sellerQuote.sellerPayable,
          status: "NEW",
          dispatch_deadline: dispatchDeadline,
        })
        .select("id")
        .single();
      if (sellerOrderError || !sellerOrder) {
        throw new Error(`seller_order insert: ${sellerOrderError?.message}`);
      }

      const sellerOrderId = (sellerOrder as { id: string }).id;
      const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
        sellerQuote.lines.map((line) => ({
          seller_order_id: sellerOrderId,
          order_id: orderId,
          product_id: line.productId,
          variant_id: line.variantId,
          name_snapshot: line.name,
          sku_snapshot: line.sku,
          qty: line.qty,
          unit_price: line.unitPrice,
          line_total: line.lineTotal,
        }))
      );
      if (itemsError) throw new Error(`order_items insert: ${itemsError.message}`);

      // Carry the Razorpay account + our seller_order id into the transfer so
      // the webhook can reconcile a transfer back to a seller order.
      if (useSplitPayments) {
        transfers.push({
          account: seller.razorpay_account_id!,
          amount: sellerQuote.sellerPayable,
          currency: "INR",
          notes: { seller_order_id: sellerOrderId, store: sellerQuote.storeName },
          on_hold: false,
        });
      }
    }

    // 5. Razorpay order carrying the split.
    if (!useSplitPayments) {
      console.warn(
        `Order ${orderNumber} created WITHOUT Route transfers (unsplit test mode). ` +
          `Sakdha collects the full amount; seller payouts are a manual obligation.`
      );
    }

    const razorpayOrder = await createRouteOrder({
      amountPaise: quote.grandTotal,
      receipt: orderNumber,
      transfers,
      notes: {
        order_id: orderId,
        order_number: orderNumber,
        // Stamped on the payment itself so reconciliation can tell, months
        // later, which orders were never split.
        settlement: useSplitPayments ? "route_split" : "manual_pending",
      },
      idempotencyKey: orderId,
    });

    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq("id", orderId);
    if (updateError) throw new Error(`order update: ${updateError.message}`);

    return NextResponse.json({
      orderId,
      orderNumber,
      razorpayOrderId: razorpayOrder.id,
      amount: quote.grandTotal,
      currency: "INR",
      // Deliberately the runtime RAZORPAY_KEY_ID — the very credential that
      // created this order — and never NEXT_PUBLIC_RAZORPAY_KEY_ID. Public env
      // vars are inlined at BUILD time, so after a key rotation without a
      // rebuild the browser would open Checkout with the old merchant's key
      // against the new merchant's order_id, and every payment would fail.
      // key_id is public by design; only key_secret must stay server-side.
      keyId: process.env.RAZORPAY_KEY_ID,
      customer: { name: address.name, email: user.email, contact: address.phone },
    });
  } catch (error) {
    // Unwind: free the held stock and mark the half-built order dead so no
    // payment can ever attach to it.
    await releaseReservation();
    if (orderId) {
      await supabaseAdmin
        .from("orders")
        .update({ payment_status: "FAILED", order_status: "CANCELLED" })
        .eq("id", orderId);
      await supabaseAdmin
        .from("seller_orders")
        .update({ status: "CANCELLED" })
        .eq("order_id", orderId);
    }

    const message =
      error instanceof RazorpayApiError
        ? error.message
        : "Could not start checkout. Nothing has been charged.";
    console.error("create-order failed:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
