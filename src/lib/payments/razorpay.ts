import "server-only";
import crypto from "node:crypto";

/**
 * Razorpay Route adapter.
 *
 * Route splits a single customer payment across linked accounts: one Razorpay
 * order carries a `transfers[]` array, one entry per seller. Razorpay moves
 * each seller's share to their linked account and Sakdha keeps the remainder
 * (commission, minus gateway fees).
 *
 * Provider specifics stay in this file so order logic never depends on
 * Razorpay's request shapes.
 */

// Orders/payments live under /v1; Route linked accounts under /v2. Paths
// passed to razorpayFetch include their own version prefix.
const API = "https://api.razorpay.com";

export class RazorpayNotConfiguredError extends Error {
  constructor() {
    super("Razorpay keys are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).");
    this.name = "RazorpayNotConfiguredError";
  }
}

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new RazorpayNotConfiguredError();
  return { keyId, keySecret };
}

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** Razorpay test keys are prefixed rzp_test_; live keys are rzp_live_. */
export function isTestMode(): boolean {
  return (process.env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_test_");
}

/**
 * ESCAPE HATCH — lets checkout run WITHOUT Route splits so the order flow can
 * be exercised before Route is activated on the Razorpay account.
 *
 * When this is on, Sakdha collects the full amount and NOTHING is transferred
 * to sellers automatically: every payout becomes a manual obligation. The
 * ledger still records SELLER_PAYABLE, so what is owed stays provable — but
 * the money has not moved.
 *
 * Two locks, both required:
 *   1. SAKDHA_ALLOW_UNSPLIT_CHECKOUT=true must be set explicitly.
 *   2. The Razorpay key must be a TEST key.
 *
 * Lock 2 is the important one: this cannot be switched on in production by a
 * stray environment variable, because live keys disable it unconditionally.
 */
export function isUnsplitCheckoutAllowed(): boolean {
  return process.env.SAKDHA_ALLOW_UNSPLIT_CHECKOUT === "true" && isTestMode();
}

async function razorpayFetch<T>(
  path: string,
  init: { method: string; body?: unknown; idempotencyKey?: string }
): Promise<T> {
  const { keyId, keySecret } = credentials();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      // Razorpay honours this on order creation, so a retried request cannot
      // create a second order for the same checkout attempt.
      ...(init.idempotencyKey ? { "X-Razorpay-Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
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
      `Razorpay request failed (${response.status})`;
    throw new RazorpayApiError(description, response.status, payload);
  }

  return payload as T;
}

export type RouteTransfer = {
  /** Seller's Route linked account, acc_XXXXXXXX. */
  account: string;
  /** Seller's share in paise. */
  amount: number;
  currency: "INR";
  notes?: Record<string, string>;
  /** Hold the payout until fulfilment is confirmed. */
  on_hold?: boolean;
};

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
};

/**
 * One order, N transfers. `amount` is the full customer-payable total; the
 * transfers must sum to at most that amount — Sakdha keeps the difference.
 */
export async function createRouteOrder(input: {
  amountPaise: number;
  receipt: string;
  transfers: RouteTransfer[];
  notes?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<RazorpayOrder> {
  const transferTotal = input.transfers.reduce((sum, t) => sum + t.amount, 0);
  if (transferTotal > input.amountPaise) {
    throw new Error(
      `Transfers (${transferTotal}) exceed order amount (${input.amountPaise}) — refusing to create order.`
    );
  }

  return razorpayFetch<RazorpayOrder>("/v1/orders", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      payment_capture: 1,
      notes: input.notes,
      transfers: input.transfers.length ? input.transfers : undefined,
    },
  });
}

export async function fetchPayment(paymentId: string) {
  return razorpayFetch<{
    id: string;
    order_id: string;
    amount: number;
    status: string;
    method: string;
    fee?: number;
    tax?: number;
    captured: boolean;
  }>(`/v1/payments/${paymentId}`, { method: "GET" });
}

// ---------------------------------------------------------------------------
// Route linked accounts (v2) — a seller cannot be paid without one.
//
// Onboarding is three calls: create the account, register a stakeholder, then
// request the "route" product and attach the settlement bank account. Razorpay
// then runs its own activation/verification, so `status` here is a request
// receipt, not an approval.
// ---------------------------------------------------------------------------

export type LinkedAccount = {
  id: string; // acc_XXXXXXXX
  status: string;
  email: string;
};

export type LinkedAccountInput = {
  email: string;
  phone: string;
  legalBusinessName: string;
  customerFacingName: string;
  contactName: string;
  businessType:
    | "individual"
    | "proprietorship"
    | "partnership"
    | "private_limited"
    | "public_limited"
    | "llp"
    | "ngo"
    | "trust"
    | "society"
    | "not_yet_registered";
  address: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
  };
  /** Our seller id, echoed back on the account for reconciliation. */
  referenceId: string;
  pan?: string;
  gst?: string;
};

export async function createLinkedAccount(input: LinkedAccountInput): Promise<LinkedAccount> {
  return razorpayFetch<LinkedAccount>("/v2/accounts", {
    method: "POST",
    idempotencyKey: input.referenceId,
    body: {
      email: input.email,
      phone: input.phone,
      type: "route",
      reference_id: input.referenceId,
      legal_business_name: input.legalBusinessName,
      customer_facing_business_name: input.customerFacingName,
      business_type: input.businessType,
      contact_name: input.contactName,
      profile: {
        category: "ecommerce",
        subcategory: "fashion_and_lifestyle",
        addresses: {
          registered: {
            street1: input.address.street1,
            street2: input.address.street2 || input.address.street1,
            city: input.address.city,
            state: input.address.state,
            postal_code: input.address.postalCode,
            country: "IN",
          },
        },
      },
      legal_info: {
        ...(input.pan ? { pan: input.pan } : {}),
        ...(input.gst ? { gst: input.gst } : {}),
      },
    },
  });
}

export async function createStakeholder(
  accountId: string,
  input: { name: string; email: string; phone?: string; pan?: string }
) {
  return razorpayFetch<{ id: string }>(`/v2/accounts/${accountId}/stakeholders`, {
    method: "POST",
    body: {
      name: input.name,
      email: input.email,
      ...(input.phone ? { phone: { primary: input.phone } } : {}),
      ...(input.pan ? { kyc: { pan: input.pan } } : {}),
    },
  });
}

/**
 * Requests the Route product for the account. Returns a product configuration
 * whose id is needed to attach settlement details.
 */
export async function requestRouteProduct(accountId: string) {
  return razorpayFetch<{ id: string; activation_status: string }>(
    `/v2/accounts/${accountId}/products`,
    {
      method: "POST",
      body: { product_name: "route", tnc_accepted: true },
    }
  );
}

/** Attaches the bank account Razorpay settles the seller's share into. */
export async function updateSettlementAccount(
  accountId: string,
  productId: string,
  bank: { beneficiaryName: string; accountNumber: string; ifsc: string }
) {
  return razorpayFetch<{ id: string; activation_status: string }>(
    `/v2/accounts/${accountId}/products/${productId}`,
    {
      method: "PATCH",
      body: {
        settlements: {
          account_number: bank.accountNumber,
          ifsc_code: bank.ifsc,
          beneficiary_name: bank.beneficiaryName,
        },
        tnc_accepted: true,
      },
    }
  );
}

export async function fetchLinkedAccount(accountId: string) {
  return razorpayFetch<LinkedAccount & { activated_at?: number }>(`/v2/accounts/${accountId}`, {
    method: "GET",
  });
}

/**
 * Checkout handshake signature: HMAC-SHA256 of "order_id|payment_id" keyed by
 * the API secret. Proves the browser's success callback really came from
 * Razorpay and was not forged by the client.
 */
export function verifyCheckoutSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = credentials();
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");
  return timingSafeEqual(expected, input.signature);
}

/** Webhook signature: HMAC-SHA256 over the RAW body, keyed by the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(expected, signature);
}

/** Constant-time compare — a plain === leaks timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}
