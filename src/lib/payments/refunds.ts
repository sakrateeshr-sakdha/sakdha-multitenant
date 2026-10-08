import "server-only";
import { RazorpayApiError } from "@/lib/payments/razorpay";

/**
 * Refunds.
 *
 * Kept separate from the main adapter because refunds have a different failure
 * posture: a failed refund must never be retried blindly, or a customer gets
 * paid twice. Razorpay's idempotency key makes a retry safe, so we always send
 * one derived from the return request.
 *
 * Note: with Route, refunding a payment that was split does NOT automatically
 * claw money back from the seller's linked account — that is a reversal, and a
 * separate concern. Today Sakdha absorbs the refund and the ledger records it
 * against the seller, so settlement nets it off their next payout.
 */

const API = "https://api.razorpay.com";

export type RefundResult =
  | { ok: true; refundId: string; amount: number }
  | { ok: false; error: string };

export async function createRefund(input: {
  paymentId: string;
  /** Omit to refund the full payment. */
  amountPaise?: number;
  notes?: Record<string, string>;
  idempotencyKey: string;
}): Promise<RefundResult> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return { ok: false, error: "Razorpay is not configured." };

  if (input.amountPaise != null && input.amountPaise <= 0) {
    return { ok: false, error: "Refund amount must be positive." };
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  try {
    const response = await fetch(`${API}/v1/payments/${input.paymentId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        // Without this, a network retry could refund the customer twice.
        "X-Razorpay-Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        ...(input.amountPaise != null ? { amount: input.amountPaise } : {}),
        speed: "normal",
        notes: input.notes,
      }),
      cache: "no-store",
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      const description =
        (payload as { error?: { description?: string } })?.error?.description ??
        `Refund failed (${response.status})`;
      throw new RazorpayApiError(description, response.status, payload);
    }

    const refund = payload as { id: string; amount: number };
    return { ok: true, refundId: refund.id, amount: refund.amount };
  } catch (error) {
    const message =
      error instanceof RazorpayApiError ? error.message : "Could not reach the payment provider.";
    console.error("createRefund failed:", error);
    return { ok: false, error: message };
  }
}
