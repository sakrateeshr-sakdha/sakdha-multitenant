"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import { createRefund } from "@/lib/payments/refunds";
import type { ActionResult } from "@/lib/actions/products";

/**
 * Returns and refunds.
 *
 * The flow is deliberately two-sided: a customer requests, the seller (or an
 * admin) approves, and only then does money move. Refunds are issued through
 * Razorpay and the resulting `refund.processed` webhook is what writes the
 * ledger — so the accounting path is identical whether a refund starts here or
 * is issued directly in the Razorpay dashboard.
 */

const RETURN_WINDOW_DAYS = 7;

const RequestSchema = z.object({
  sellerOrderId: z.string().uuid(),
  reason: z.string().min(3).max(500),
  items: z
    .array(z.object({ orderItemId: z.string().uuid(), qty: z.number().int().min(1) }))
    .min(1),
});

export type ReturnRequestInput = z.input<typeof RequestSchema>;

/** Customer-initiated. Only a delivered package, inside the return window. */
export async function requestReturn(input: ReturnRequestInput): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to request a return." };

  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose what you want to return and why." };
  const data = parsed.data;

  const { data: sellerOrder } = await supabase
    .from("seller_orders")
    .select("id, status, order_id, orders:order_id(customer_id, payment_status), shipments(delivered_at)")
    .eq("id", data.sellerOrderId)
    .maybeSingle();
  if (!sellerOrder) return { ok: false, error: "Order not found." };

  const row = sellerOrder as unknown as {
    id: string;
    status: string;
    orders: { customer_id: string; payment_status: string } | null;
    shipments: { delivered_at: string | null }[];
  };

  if (row.orders?.customer_id !== user.id) return { ok: false, error: "Order not found." };
  if (row.orders?.payment_status !== "PAID") {
    return { ok: false, error: "This order was never paid for." };
  }
  if (row.status !== "DELIVERED") {
    return { ok: false, error: "You can request a return once the package is delivered." };
  }

  // The window runs from delivery, not from the order date.
  const deliveredAt = row.shipments?.[0]?.delivered_at;
  if (deliveredAt) {
    const days = (Date.now() - new Date(deliveredAt).getTime()) / 86_400_000;
    if (days > RETURN_WINDOW_DAYS) {
      return {
        ok: false,
        error: `The ${RETURN_WINDOW_DAYS}-day return window for this package has closed.`,
      };
    }
  }

  const { data: existing } = await supabase
    .from("return_requests")
    .select("id, status")
    .eq("seller_order_id", data.sellerOrderId)
    .maybeSingle();
  if (existing && !["REJECTED"].includes((existing as { status: string }).status)) {
    return { ok: false, error: "A return has already been requested for this package." };
  }

  // Price the return from the order lines, never from the client.
  const { data: orderItems } = await supabase
    .from("order_items")
    .select("id, qty, unit_price")
    .eq("seller_order_id", data.sellerOrderId);
  const itemsById = new Map(
    ((orderItems ?? []) as { id: string; qty: number; unit_price: number }[]).map((i) => [i.id, i])
  );

  for (const line of data.items) {
    const item = itemsById.get(line.orderItemId);
    if (!item) return { ok: false, error: "That item is not part of this package." };
    if (line.qty > item.qty) {
      return { ok: false, error: "You cannot return more than you bought." };
    }
  }

  const { data: request, error } = await supabase
    .from("return_requests")
    .insert({
      seller_order_id: data.sellerOrderId,
      customer_id: user.id,
      reason: data.reason,
      status: "REQUESTED",
    })
    .select("id")
    .single();
  if (error || !request) return { ok: false, error: "Could not create the return request." };

  const requestId = (request as { id: string }).id;
  const lines = data.items.map((line) => {
    const item = itemsById.get(line.orderItemId)!;
    return {
      return_request_id: requestId,
      order_item_id: line.orderItemId,
      qty: line.qty,
      refund_amount: item.unit_price * line.qty,
    };
  });

  const { error: itemsError } = await supabase.from("return_items").insert(lines);
  if (itemsError) {
    await supabaseAdmin.from("return_requests").delete().eq("id", requestId);
    return { ok: false, error: "Could not record the returned items." };
  }

  await supabaseAdmin
    .from("seller_orders")
    .update({ status: "RETURN_REQUESTED" })
    .eq("id", data.sellerOrderId);

  revalidatePath("/account");
  revalidatePath("/seller/returns");
  return { ok: true };
}

const DecisionSchema = z.object({
  returnRequestId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().max(500).optional().or(z.literal("")),
});

/**
 * Seller decision. Approving issues the refund immediately — the goods are
 * already with the customer or on their way back, and making them wait for a
 * second manual step is how refund complaints start.
 */
export async function decideReturn(
  input: z.input<typeof DecisionSchema>
): Promise<ActionResult<{ refunded: boolean }>> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = DecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid decision." };
  const { returnRequestId, approve } = parsed.data;

  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (!seller) return { ok: false, error: "Sellers only." };

  const { data: request } = await supabase
    .from("return_requests")
    .select(
      "id, status, seller_order_id, seller_orders:seller_order_id(seller_id, order_id), return_items(refund_amount)"
    )
    .eq("id", returnRequestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "Return request not found." };

  const row = request as unknown as {
    id: string;
    status: string;
    seller_order_id: string;
    seller_orders: { seller_id: string; order_id: string } | null;
    return_items: { refund_amount: number }[];
  };

  if (row.seller_orders?.seller_id !== (seller as { id: string }).id) {
    return { ok: false, error: "Return request not found." };
  }
  if (row.status !== "REQUESTED") {
    return { ok: false, error: "This return has already been decided." };
  }

  if (!approve) {
    await supabase.from("return_requests").update({ status: "REJECTED" }).eq("id", row.id);
    await supabaseAdmin
      .from("seller_orders")
      .update({ status: "DELIVERED" })
      .eq("id", row.seller_order_id);
    revalidatePath("/seller/returns");
    revalidatePath("/account");
    return { ok: true, refunded: false };
  }

  const amount = row.return_items.reduce((sum, i) => sum + i.refund_amount, 0);
  if (amount <= 0) return { ok: false, error: "Nothing to refund." };

  // Find the captured payment to refund against.
  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("razorpay_payment_id")
    .eq("order_id", row.seller_orders!.order_id)
    .eq("status", "captured")
    .maybeSingle();

  await supabase.from("return_requests").update({ status: "APPROVED" }).eq("id", row.id);

  if (!isRazorpayConfigured() || !payment) {
    // Approve the return but be explicit that no money has moved.
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: user.id,
      action: "return.approved_without_refund",
      entity: "return_requests",
      entity_id: row.id,
      diff_json: { amount, reason: payment ? "razorpay_not_configured" : "no_captured_payment" },
    });
    revalidatePath("/seller/returns");
    return { ok: true, refunded: false };
  }

  const result = await createRefund({
    paymentId: (payment as { razorpay_payment_id: string }).razorpay_payment_id,
    amountPaise: amount,
    notes: { seller_order_id: row.seller_order_id, return_request_id: row.id },
    idempotencyKey: row.id,
  });

  if (!result.ok) {
    return { ok: false, error: `Return approved, but the refund failed: ${result.error}` };
  }

  // The refund.processed webhook writes the refund row and the ledger entry —
  // not this action — so the accounting is identical however a refund starts.
  await supabaseAdmin
    .from("return_requests")
    .update({ status: "REFUNDED" })
    .eq("id", row.id);
  await supabaseAdmin
    .from("seller_orders")
    .update({ status: "RETURNED" })
    .eq("id", row.seller_order_id);

  revalidatePath("/seller/returns");
  revalidatePath("/account");
  return { ok: true, refunded: true };
}
