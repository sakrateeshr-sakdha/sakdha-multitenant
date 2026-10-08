"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/products";

/**
 * Reviews, verified-purchase only.
 *
 * The RLS policy added in 0011 is the real gate: a customer may only insert a
 * review whose order_item they actually bought, on a paid order that was
 * delivered. This action does the same check first so the UI can explain why,
 * but the database is what enforces it.
 *
 * Status is APPROVED on write rather than PENDING: the purchase is already
 * verified, so holding genuine feedback in a queue adds latency without adding
 * safety. Admin moderation can still reject afterwards, and only APPROVED rows
 * feed the public aggregates.
 */

const ReviewSchema = z.object({
  orderItemId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).optional().or(z.literal("")),
});

export type ReviewInput = z.input<typeof ReviewSchema>;

export async function submitReview(input: ReviewInput): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to leave a review." };

  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a rating from 1 to 5." };
  const data = parsed.data;

  // Resolve the purchase. RLS on order_items already limits this to the
  // caller's own orders, so a forged id simply finds nothing.
  const { data: item } = await supabase
    .from("order_items")
    .select(
      "id, product_id, order_id, seller_order_id, products:product_id(store_id), seller_orders:seller_order_id(status)"
    )
    .eq("id", data.orderItemId)
    .maybeSingle();

  if (!item) return { ok: false, error: "We couldn't find that purchase." };

  const row = item as unknown as {
    id: string;
    product_id: string | null;
    products: { store_id: string } | null;
    seller_orders: { status: string } | null;
  };

  if (!row.product_id) {
    return { ok: false, error: "That product is no longer available to review." };
  }
  if (row.seller_orders?.status !== "DELIVERED") {
    return { ok: false, error: "You can review this once it has been delivered." };
  }

  const { error } = await supabase.from("reviews").insert({
    product_id: row.product_id,
    store_id: row.products?.store_id ?? null,
    customer_id: user.id,
    order_item_id: row.id,
    rating: data.rating,
    body: data.body || null,
    verified_purchase: true,
    status: "APPROVED",
  });

  if (error) {
    // The partial unique index on order_item_id is what stops a customer
    // reviewing the same line twice to move the average.
    if (error.code === "23505") {
      return { ok: false, error: "You have already reviewed this item." };
    }
    if (error.code === "42501") {
      return { ok: false, error: "Only delivered purchases can be reviewed." };
    }
    return { ok: false, error: "Could not save your review." };
  }

  revalidatePath("/account");
  return { ok: true };
}

const ResponseSchema = z.object({
  reviewId: z.string().uuid(),
  response: z.string().min(1).max(1000),
});

/** A seller's public reply. RLS restricts this to reviews on their own store. */
export async function respondToReview(
  input: z.input<typeof ResponseSchema>
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = ResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write a reply first." };

  const { error } = await supabase
    .from("reviews")
    .update({ seller_response: parsed.data.response })
    .eq("id", parsed.data.reviewId);
  if (error) return { ok: false, error: "Could not post your reply." };

  revalidatePath("/seller/reviews");
  return { ok: true };
}
