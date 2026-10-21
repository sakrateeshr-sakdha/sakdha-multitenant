import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";

/**
 * Razorpay webhook — the authority on payment state.
 *
 * Rules this endpoint lives by:
 *  1. Verify the HMAC over the RAW body before parsing anything.
 *  2. Be idempotent: Razorpay retries, and a replayed event must not double
 *     the ledger. The event id is claimed in webhook_events first; a duplicate
 *     insert means we have already handled it.
 *  3. Always answer 200 once the event is ours, even on a no-op — a non-200
 *     makes Razorpay retry forever.
 */
export async function POST(request: Request) {
  // Raw text, not request.json(): the signature covers the exact bytes sent.
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  // Razorpay sends the event id in a header; fall back to a deterministic key
  // so idempotency still holds if it is ever absent.
  const eventId =
    request.headers.get("x-razorpay-event-id") ??
    `${event.event}:${event.payload?.payment?.entity?.id ?? ""}:${event.created_at ?? ""}`;

  const { error: claimError } = await supabaseAdmin
    .from("webhook_events")
    .insert({ id: eventId, event_type: event.event });

  if (claimError) {
    // Unique violation → already processed. Acknowledge and stop.
    if (claimError.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("webhook claim failed:", claimError);
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  try {
    switch (event.event) {
      case "payment.captured":
        await handlePaymentCaptured(event);
        break;
      case "payment.failed":
        await handlePaymentFailed(event);
        break;
      case "transfer.processed":
      case "transfer.settled":
        await handleTransfer(event);
        break;
      case "refund.processed":
        await handleRefund(event);
        break;
      default:
        // Unhandled event types are acknowledged, not retried.
        break;
    }
  } catch (error) {
    console.error(`webhook ${event.event} failed:`, error);
    // Release the idempotency claim so a retry can genuinely re-run.
    await supabaseAdmin.from("webhook_events").delete().eq("id", eventId);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------

type RazorpayEvent = {
  event: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: PaymentEntity };
    transfer?: { entity?: TransferEntity };
    refund?: { entity?: RefundEntity };
  };
};

type PaymentEntity = {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  method?: string;
  fee?: number;
  tax?: number;
};

type TransferEntity = {
  id: string;
  recipient: string;
  amount: number;
  notes?: Record<string, string>;
};

type RefundEntity = {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  notes?: Record<string, string>;
};

async function findOrderByRazorpayOrderId(razorpayOrderId: string) {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, customer_id, grand_total, commission_total, payment_status")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();
  return data as {
    id: string;
    order_number: string;
    customer_id: string;
    grand_total: number;
    commission_total: number;
    payment_status: string;
  } | null;
}

/**
 * Empty the customer's bag once their payment succeeds.
 *
 * Deliberately on capture, not on order creation: an abandoned or failed
 * checkout must leave the bag intact so the customer can simply try again.
 */
async function clearCart(customerId: string) {
  const { data: cart } = await supabaseAdmin
    .from("carts")
    .select("id")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!cart) return;
  await supabaseAdmin.from("cart_items").delete().eq("cart_id", (cart as { id: string }).id);
}

/**
 * Money is real: commit the reserved stock, mark everything paid, and write the
 * ledger so every rupee is traceable.
 */
async function handlePaymentCaptured(event: RazorpayEvent) {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  const order = await findOrderByRazorpayOrderId(payment.order_id);
  if (!order) {
    console.error(`payment.captured for unknown order ${payment.order_id}`);
    return;
  }

  await supabaseAdmin.from("payments").upsert(
    {
      order_id: order.id,
      razorpay_payment_id: payment.id,
      amount: payment.amount,
      status: "captured",
      method: payment.method ?? null,
      captured_at: new Date().toISOString(),
      raw_event_json: event as unknown as Record<string, unknown>,
    },
    { onConflict: "razorpay_payment_id" }
  );

  // Already settled by an earlier delivery of this event? Stop before the
  // ledger is written twice.
  if (order.payment_status === "PAID") return;

  // store_id comes from the seller_order itself — the ownership recorded when
  // the order was placed. Never re-resolved from the seller's current store,
  // which could have changed since.
  const { data: sellerOrders } = await supabaseAdmin
    .from("seller_orders")
    .select("id, seller_id, store_id, subtotal, shipping, discount, commission, seller_payable")
    .eq("order_id", order.id);

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("variant_id, qty")
    .eq("order_id", order.id);

  // Reserved → gone.
  const commitItems = ((items ?? []) as { variant_id: string | null; qty: number }[])
    .filter((i) => i.variant_id)
    .map((i) => ({ variant_id: i.variant_id, qty: i.qty }));
  if (commitItems.length > 0) {
    await supabaseAdmin.rpc("commit_inventory", { p_items: commitItems });
  }

  await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "PAID",
      order_status: "PAID",
      razorpay_payment_id: payment.id,
    })
    .eq("id", order.id);

  await supabaseAdmin
    .from("seller_orders")
    .update({ status: "ACCEPTED" })
    .eq("order_id", order.id)
    .eq("status", "NEW");

  // Ledger: one row per real movement of money.
  //
  // Every row MUST carry the identical set of keys. PostgREST rejects a bulk
  // insert whose objects have differing keys (PGRST102, "All object keys must
  // match"), which silently cost us the entire ledger for an order.
  type LedgerRow = {
    order_id: string;
    seller_order_id: string | null;
    seller_id: string | null;
    /** Owning tenant. NULL only for platform-level rows (gateway fees). */
    store_id: string | null;
    type: string;
    amount: number;
    direction: "debit" | "credit";
    ref_json: Record<string, unknown>;
  };

  const entry = (
    type: string,
    amount: number,
    direction: "debit" | "credit",
    extra: Partial<LedgerRow> = {}
  ): LedgerRow => ({
    order_id: order.id,
    seller_order_id: null,
    seller_id: null,
    store_id: null,
    ref_json: {},
    type,
    amount,
    direction,
    ...extra,
  });

  const ledger: LedgerRow[] = [];
  for (const so of (sellerOrders ?? []) as {
    id: string;
    seller_id: string;
    store_id: string;
    subtotal: number;
    shipping: number;
    discount: number;
    commission: number;
    seller_payable: number;
  }[]) {
    // Both IDs travel together on every seller-scoped row. They are read from
    // the same seller_order, so they cannot disagree.
    const scope = { seller_order_id: so.id, seller_id: so.seller_id, store_id: so.store_id };
    ledger.push(entry("PRODUCT_SALE", so.subtotal, "credit", scope));
    if (so.shipping > 0) ledger.push(entry("SHIPPING", so.shipping, "credit", scope));
    if (so.discount > 0) ledger.push(entry("DISCOUNT", so.discount, "debit", scope));
    ledger.push(entry("SAKDHA_COMMISSION", so.commission, "debit", scope));
    ledger.push(entry("SELLER_PAYABLE", so.seller_payable, "credit", scope));
  }

  // Gateway fee is charged to Sakdha on the whole payment, not per seller.
  if (payment.fee) {
    ledger.push(
      entry("PAYMENT_GATEWAY_FEE", payment.fee, "debit", {
        ref_json: { razorpay_payment_id: payment.id, tax: payment.tax ?? 0 },
      })
    );
  }

  if (ledger.length > 0) {
    const { error } = await supabaseAdmin.from("ledger_entries").insert(ledger);
    // The ledger is the financial record. If it cannot be written, throw so the
    // handler returns 500, the idempotency claim is released, and Razorpay
    // retries — rather than leaving a PAID order with no accounting behind it.
    if (error) {
      throw new Error(`ledger insert failed for order ${order.order_number}: ${error.message}`);
    }
  }

  // The bag has become an order; it should not still be sitting there.
  await clearCart(order.customer_id);
}

/** Payment failed: the hold must not outlive the attempt. */
async function handlePaymentFailed(event: RazorpayEvent) {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  const order = await findOrderByRazorpayOrderId(payment.order_id);
  if (!order || order.payment_status === "PAID") return;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("variant_id, qty")
    .eq("order_id", order.id);

  const releaseItems = ((items ?? []) as { variant_id: string | null; qty: number }[])
    .filter((i) => i.variant_id)
    .map((i) => ({ variant_id: i.variant_id, qty: i.qty }));
  if (releaseItems.length > 0) {
    await supabaseAdmin.rpc("release_inventory", { p_items: releaseItems });
  }

  await supabaseAdmin
    .from("orders")
    .update({ payment_status: "FAILED", order_status: "CANCELLED" })
    .eq("id", order.id);
  await supabaseAdmin
    .from("seller_orders")
    .update({ status: "CANCELLED" })
    .eq("order_id", order.id);

  await supabaseAdmin.from("payments").upsert(
    {
      order_id: order.id,
      razorpay_payment_id: payment.id,
      amount: payment.amount,
      status: "failed",
      method: payment.method ?? null,
      raw_event_json: event as unknown as Record<string, unknown>,
    },
    { onConflict: "razorpay_payment_id" }
  );
}

/** Route moved a seller's share — record the split against their order. */
async function handleTransfer(event: RazorpayEvent) {
  const transfer = event.payload?.transfer?.entity;
  if (!transfer) return;

  // create-order stamps our seller_order id into the transfer notes.
  const sellerOrderId = transfer.notes?.seller_order_id;
  if (!sellerOrderId) {
    console.error(`transfer ${transfer.id} has no seller_order_id note`);
    return;
  }

  const settled = event.event === "transfer.settled";

  await supabaseAdmin.from("payment_splits").upsert(
    {
      seller_order_id: sellerOrderId,
      razorpay_transfer_id: transfer.id,
      amount: transfer.amount,
      status: settled ? "settled" : "processed",
      settled_at: settled ? new Date().toISOString() : null,
    },
    { onConflict: "razorpay_transfer_id" }
  );

  await supabaseAdmin
    .from("seller_orders")
    .update({ razorpay_transfer_id: transfer.id })
    .eq("id", sellerOrderId);
}

async function handleRefund(event: RazorpayEvent) {
  const refund = event.payload?.refund?.entity;
  if (!refund) return;

  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("order_id")
    .eq("razorpay_payment_id", refund.payment_id)
    .maybeSingle();
  if (!payment) return;

  const orderId = (payment as { order_id: string }).order_id;
  const sellerOrderId = (refund.notes?.seller_order_id as string | undefined) ?? null;

  await supabaseAdmin.from("refunds").upsert(
    {
      order_id: orderId,
      seller_order_id: sellerOrderId,
      razorpay_refund_id: refund.id,
      amount: refund.amount,
      status: refund.status,
    },
    { onConflict: "razorpay_refund_id" }
  );

  /**
   * Resolve who this refund belongs to.
   *
   * This used to be omitted entirely, and the omission was expensive: a REFUND
   * row with a NULL seller_id is skipped by settlePeriod() and never matched by
   * getSellerEarnings()'s `.eq("seller_id", …)`, so refunds silently failed to
   * reduce any payout. `netPayable = max(0, earned − refunds)` could only ever
   * see refunds = 0.
   *
   * Read from the seller_order rather than the refund notes: `notes` is echoed
   * back by the provider and is not proof of ownership, whereas the
   * seller_order is our own record of who sold the goods.
   */
  let refundOwner: { seller_id: string; store_id: string } | null = null;
  if (sellerOrderId) {
    const { data } = await supabaseAdmin
      .from("seller_orders")
      .select("seller_id, store_id")
      .eq("id", sellerOrderId)
      // The seller_order must belong to the order the payment was for — a
      // mismatched note must not be able to charge a refund to another store.
      .eq("order_id", orderId)
      .maybeSingle();
    refundOwner = (data as { seller_id: string; store_id: string } | null) ?? null;
  }

  if (sellerOrderId && !refundOwner) {
    // Loud rather than silently unattributed: an unowned refund understates a
    // deduction, which is the expensive direction to get wrong.
    console.error(
      `refund ${refund.id}: seller_order ${sellerOrderId} does not belong to order ${orderId}; ` +
        `the ledger row will be unattributed and will NOT reduce any settlement.`
    );
  }

  const { error: ledgerError } = await supabaseAdmin.from("ledger_entries").insert({
    order_id: orderId,
    seller_order_id: sellerOrderId,
    seller_id: refundOwner?.seller_id ?? null,
    store_id: refundOwner?.store_id ?? null,
    type: "REFUND",
    amount: refund.amount,
    direction: "debit",
    ref_json: { razorpay_refund_id: refund.id },
  });
  if (ledgerError) {
    throw new Error(`refund ledger insert failed for ${refund.id}: ${ledgerError.message}`);
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("grand_total")
    .eq("id", orderId)
    .maybeSingle();

  const full = order && refund.amount >= (order as { grand_total: number }).grand_total;
  await supabaseAdmin
    .from("orders")
    .update({
      payment_status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
      order_status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
    })
    .eq("id", orderId);
}
