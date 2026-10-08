import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/**
 * The browser's success handshake. This gives the customer a fast, trustworthy
 * confirmation — but it is NOT what finalises money. The webhook is the
 * authority: it runs even if the customer closes the tab, and it is the only
 * place inventory is committed and the ledger is written.
 *
 * Here we only verify the signature and move the order out of PENDING_PAYMENT
 * so the confirmation page has something true to show.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const body = parsed.data;

  const signatureValid = verifyCheckoutSignature({
    razorpayOrderId: body.razorpay_order_id,
    razorpayPaymentId: body.razorpay_payment_id,
    signature: body.razorpay_signature,
  });
  if (!signatureValid) {
    return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
  }

  // Signature proves Razorpay authored it; this proves the order is *ours* and
  // belongs to the signed-in customer.
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, customer_id, payment_status")
    .eq("razorpay_order_id", body.razorpay_order_id)
    .maybeSingle();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const row = order as {
    id: string;
    order_number: string;
    customer_id: string;
    payment_status: string;
  };
  if (row.customer_id !== user.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // The webhook may already have captured this; never regress a PAID order.
  if (row.payment_status === "PENDING_PAYMENT") {
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "PAID", order_status: "PAID", razorpay_payment_id: body.razorpay_payment_id })
      .eq("id", row.id)
      .eq("payment_status", "PENDING_PAYMENT");
  }

  return NextResponse.json({ ok: true, orderNumber: row.order_number });
}
