"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canTransition,
  rollUpOrderStatus,
  type OrderStatus,
  type SellerOrderStatus,
} from "@/lib/commerce/orderStatus";
import type { ActionResult } from "@/lib/actions/products";

/**
 * Seller fulfilment: moving a seller_order from NEW through to DELIVERED and
 * recording the shipment that carries it.
 *
 * Child-order writes go through the user-scoped client, so `seller_orders`'
 * RLS decides ownership. The PARENT order is updated with the service role on
 * purpose: sellers may read an order they ship for but must never be able to
 * write to it directly — the parent status is derived, not seller-controlled.
 */

const ShipmentSchema = z.object({
  carrier: z.string().min(1).max(80),
  trackingNumber: z.string().min(1).max(120),
  shippingMethod: z.string().max(80).optional().or(z.literal("")),
  estimatedDeliveryFrom: z.string().max(20).optional().or(z.literal("")),
  estimatedDeliveryTo: z.string().max(20).optional().or(z.literal("")),
});

export type ShipmentInput = z.input<typeof ShipmentSchema>;

/** Confirms the caller's seller owns this child order, and returns its context. */
async function loadSellerOrder(sellerOrderId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS lets a customer read their own seller_orders too, so ownership is
  // checked explicitly here rather than inferred from a successful read.
  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (!seller) return null;

  const { data: sellerOrder } = await supabase
    .from("seller_orders")
    .select("id, order_id, seller_id, status, dispatch_deadline")
    .eq("id", sellerOrderId)
    .maybeSingle();
  if (!sellerOrder) return null;

  const row = sellerOrder as {
    id: string;
    order_id: string;
    seller_id: string;
    status: string;
    dispatch_deadline: string | null;
  };
  if (row.seller_id !== (seller as { id: string }).id) return null;

  return { supabase, sellerOrder: row };
}

/**
 * Recomputes the parent order's status from all of its children.
 *
 * Service role: there is deliberately no UPDATE policy on `orders` for sellers.
 */
async function syncParentOrder(orderId: string) {
  const { data: children } = await supabaseAdmin
    .from("seller_orders")
    .select("status")
    .eq("order_id", orderId);

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("order_status, payment_status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const next = rollUpOrderStatus(
    ((children ?? []) as { status: string }[]).map((c) => c.status),
    (order as { order_status: OrderStatus }).order_status
  );

  if (next !== (order as { order_status: string }).order_status) {
    await supabaseAdmin.from("orders").update({ order_status: next }).eq("id", orderId);
  }
}

/**
 * Advances a seller order. The transition table is the authority — a client
 * cannot jump a package straight from NEW to DELIVERED.
 */
export async function advanceSellerOrder(
  sellerOrderId: string,
  to: SellerOrderStatus
): Promise<ActionResult> {
  const context = await loadSellerOrder(sellerOrderId);
  if (!context) return { ok: false, error: "Order not found." };

  const { supabase, sellerOrder } = context;

  if (!canTransition(sellerOrder.status, to)) {
    return {
      ok: false,
      error: `Cannot move an order from ${sellerOrder.status.toLowerCase()} to ${to.toLowerCase()}.`,
    };
  }

  // Only a paid order can be fulfilled.
  const { data: parent } = await supabase
    .from("orders")
    .select("payment_status")
    .eq("id", sellerOrder.order_id)
    .maybeSingle();
  if ((parent as { payment_status: string } | null)?.payment_status !== "PAID") {
    return { ok: false, error: "This order has not been paid for." };
  }

  const { error } = await supabase
    .from("seller_orders")
    .update({ status: to })
    .eq("id", sellerOrderId);
  if (error) return { ok: false, error: "Could not update the order." };

  // Keep any shipment in step with the package it represents.
  if (["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(to)) {
    const timestamps =
      to === "SHIPPED"
        ? { status: to, shipped_at: new Date().toISOString() }
        : to === "DELIVERED"
          ? { status: to, delivered_at: new Date().toISOString() }
          : { status: to };
    await supabase.from("shipments").update(timestamps).eq("seller_order_id", sellerOrderId);
  }

  await syncParentOrder(sellerOrder.order_id);

  revalidatePath("/seller/orders");
  revalidatePath(`/seller/orders/${sellerOrderId}`);
  return { ok: true };
}

/**
 * Records the shipment and marks the package shipped in one step — a seller
 * who has handed a parcel to a courier has done both, and splitting them just
 * invites orders that are "shipped" with no tracking.
 */
export async function createShipment(
  sellerOrderId: string,
  input: ShipmentInput
): Promise<ActionResult> {
  const context = await loadSellerOrder(sellerOrderId);
  if (!context) return { ok: false, error: "Order not found." };

  const { supabase, sellerOrder } = context;

  const parsed = ShipmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Enter a carrier and tracking number.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  if (!["ACCEPTED", "PROCESSING", "READY_TO_SHIP"].includes(sellerOrder.status)) {
    return {
      ok: false,
      error: `A ${sellerOrder.status.toLowerCase()} order cannot be shipped.`,
    };
  }

  const { data: parent } = await supabase
    .from("orders")
    .select("payment_status")
    .eq("id", sellerOrder.order_id)
    .maybeSingle();
  if ((parent as { payment_status: string } | null)?.payment_status !== "PAID") {
    return { ok: false, error: "This order has not been paid for." };
  }

  const { data: shipment, error } = await supabase
    .from("shipments")
    .insert({
      seller_order_id: sellerOrderId,
      carrier: data.carrier,
      tracking_number: data.trackingNumber,
      shipping_method: data.shippingMethod || null,
      estimated_delivery_from: data.estimatedDeliveryFrom || null,
      estimated_delivery_to: data.estimatedDeliveryTo || null,
      status: "SHIPPED",
      shipped_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !shipment) return { ok: false, error: "Could not record the shipment." };

  // Every line on this seller order travels in this parcel. Partial shipments
  // get their own UI later; the schema already supports them.
  const { data: items } = await supabase
    .from("order_items")
    .select("id, qty")
    .eq("seller_order_id", sellerOrderId);

  const shipmentId = (shipment as { id: string }).id;
  const rows = ((items ?? []) as { id: string; qty: number }[]).map((item) => ({
    shipment_id: shipmentId,
    order_item_id: item.id,
    qty: item.qty,
  }));
  if (rows.length > 0) {
    const { error: itemsError } = await supabase.from("shipment_items").insert(rows);
    if (itemsError) {
      // A shipment with no lines is worse than no shipment: it would show the
      // customer a tracking number for an empty parcel, and every retry would
      // leave another orphan behind.
      await supabaseAdmin.from("shipments").delete().eq("id", shipmentId);
      return { ok: false, error: "Could not attach items to the shipment." };
    }
  }

  const { error: statusError } = await supabase
    .from("seller_orders")
    .update({ status: "SHIPPED" })
    .eq("id", sellerOrderId);
  if (statusError) return { ok: false, error: "Shipment saved, but the status did not update." };

  await syncParentOrder(sellerOrder.order_id);

  revalidatePath("/seller/orders");
  revalidatePath(`/seller/orders/${sellerOrderId}`);
  return { ok: true };
}

/**
 * Cancelling returns the goods to stock. Refunding the customer is a separate
 * act through Razorpay — this does not move money, and says so in the UI.
 */
export async function cancelSellerOrder(
  sellerOrderId: string,
  reason: string
): Promise<ActionResult> {
  const context = await loadSellerOrder(sellerOrderId);
  if (!context) return { ok: false, error: "Order not found." };

  const { supabase, sellerOrder } = context;
  if (!canTransition(sellerOrder.status, "CANCELLED")) {
    return { ok: false, error: "This order can no longer be cancelled." };
  }

  const { error } = await supabase
    .from("seller_orders")
    .update({ status: "CANCELLED" })
    .eq("id", sellerOrderId);
  if (error) return { ok: false, error: "Could not cancel the order." };

  // Stock was committed at payment capture, so put it back on the shelf.
  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("variant_id, qty")
    .eq("seller_order_id", sellerOrderId);

  for (const item of ((items ?? []) as { variant_id: string | null; qty: number }[])) {
    if (!item.variant_id) continue;
    const { data: variant } = await supabaseAdmin
      .from("product_variants")
      .select("inventory_qty")
      .eq("id", item.variant_id)
      .maybeSingle();
    if (!variant) continue;
    await supabaseAdmin
      .from("product_variants")
      .update({ inventory_qty: (variant as { inventory_qty: number }).inventory_qty + item.qty })
      .eq("id", item.variant_id);
  }

  await supabaseAdmin.from("audit_logs").insert({
    action: "seller_order.cancelled",
    entity: "seller_orders",
    entity_id: sellerOrderId,
    diff_json: { reason },
  });

  await syncParentOrder(sellerOrder.order_id);

  revalidatePath("/seller/orders");
  revalidatePath(`/seller/orders/${sellerOrderId}`);
  return { ok: true };
}
