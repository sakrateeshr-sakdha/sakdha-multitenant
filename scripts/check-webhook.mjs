/**
 * Exercises /api/webhooks/razorpay with correctly-signed fixtures.
 *
 * The webhook is the authority for inventory and the ledger — it runs even if
 * the customer closes the tab — so it needs testing without waiting for a real
 * Razorpay delivery (which cannot reach localhost anyway).
 *
 * Requires: the app serving, RAZORPAY_WEBHOOK_SECRET set, and two orders in
 * PENDING_PAYMENT passed as arguments.
 *
 * Run:  NODE_OPTIONS= node scripts/check-webhook.mjs <captureOrderNo> <failOrderNo> [qtyOnCaptureOrder] [qtyOnFailOrder]
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";

const [captureOrderNo, failOrderNo] = process.argv.slice(2);
if (!captureOrderNo || !failOrderNo) {
  console.error("Usage: node scripts/check-webhook.mjs <captureOrderNo> <failOrderNo>");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const SECRET = env.RAZORPAY_WEBHOOK_SECRET;
const ENDPOINT = "http://localhost:3100/api/webhooks/razorpay";

/**
 * Every identifier is namespaced to the orders under test. Reusing a fixed id
 * would hit the real idempotency table from a previous run and every event
 * would be skipped as a duplicate — the suite would "pass" by doing nothing.
 */
const RUN = `${captureOrderNo}_${failOrderNo}`.replace(/[^A-Za-z0-9_]/g, "");
const ID = {
  captureEvent: `evt_capture_${RUN}`,
  failEvent: `evt_failed_${RUN}`,
  transferEvent: `evt_transfer_${RUN}`,
  refundEvent: `evt_refund_${RUN}`,
  unknownEvent: `evt_unknown_${RUN}`,
  badEvent: `evt_bad_${RUN}`,
  payment: `pay_${RUN}`,
  failedPayment: `payfail_${RUN}`,
  transfer: `trf_${RUN}`,
  refund: `rfnd_${RUN}`,
};

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
  ok ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sign the exact bytes, the way Razorpay does. */
async function send(event, eventId, { badSignature = false } = {}) {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac("sha256", badSignature ? "wrong-secret" : SECRET).update(raw).digest("hex");
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": sig,
      "x-razorpay-event-id": eventId,
    },
    body: raw,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const getOrder = async (n) =>
  (await db.from("orders")
    .select("id, order_number, grand_total, commission_total, payment_status, order_status, razorpay_order_id, seller_orders(id,status,seller_payable,commission)")
    .eq("order_number", n).single()).data;

const getQty = async (orderId) => {
  const { data } = await db.from("order_items").select("qty, variant_id").eq("order_id", orderId);
  return (data ?? []).filter((i) => i.variant_id).reduce((n, i) => n + i.qty, 0);
};

const variant = async () =>
  (await db.from("product_variants").select("inventory_qty, reserved_qty").eq("sku", "CHIKANKARIANARKAL-M").single()).data;

const ledgerFor = async (id) =>
  (await db.from("ledger_entries").select("type, amount, direction").eq("order_id", id)).data ?? [];

const captured = await getOrder(captureOrderNo);
const failing = await getOrder(failOrderNo);
const captureQty = await getQty(captured.id);
const failQty = await getQty(failing.id);

console.log(`capture target: ${captured.order_number} (${captured.razorpay_order_id}) total=${captured.grand_total} variantUnits=${captureQty}`);
console.log(`failure target: ${failing.order_number} (${failing.razorpay_order_id}) variantUnits=${failQty}\n`);

// 1. Signature enforcement ----------------------------------------------------
const bad = await send({ event: "payment.captured", payload: {} }, ID.badEvent, { badSignature: true });
check("forged signature is rejected", bad.status === 401, `status=${bad.status}`);

// 2. payment.captured ---------------------------------------------------------
const before = await variant();
const captureEvent = {
  event: "payment.captured",
  created_at: 1791226000,
  payload: { payment: { entity: {
    id: ID.payment, order_id: captured.razorpay_order_id,
    amount: captured.grand_total, status: "captured", method: "card", fee: 7083, tax: 1080,
  } } },
};
const capRes = await send(captureEvent, ID.captureEvent);
check("payment.captured accepted", capRes.status === 200, JSON.stringify(capRes.body));
await wait(1500);

const afterOrder = await getOrder(captureOrderNo);
const afterVariant = await variant();
check("order marked PAID", afterOrder.payment_status === "PAID", afterOrder.payment_status);
check("seller_orders advanced to ACCEPTED",
  afterOrder.seller_orders.every((s) => s.status === "ACCEPTED"),
  afterOrder.seller_orders.map((s) => s.status).join(","));
check("inventory committed (stock actually leaves)",
  afterVariant.inventory_qty === before.inventory_qty - captureQty,
  `${before.inventory_qty} -> ${afterVariant.inventory_qty} (${captureQty} units)`);
check("hold released on commit",
  afterVariant.reserved_qty === before.reserved_qty - captureQty,
  `${before.reserved_qty} -> ${afterVariant.reserved_qty}`);

const ledger = await ledgerFor(captured.id);
const byType = Object.fromEntries(ledger.map((e) => [e.type, e.amount]));
check("ledger: PRODUCT_SALE", byType.PRODUCT_SALE > 0, String(byType.PRODUCT_SALE));
check("ledger: SAKDHA_COMMISSION matches the order",
  byType.SAKDHA_COMMISSION === captured.commission_total,
  `${byType.SAKDHA_COMMISSION} vs ${captured.commission_total}`);
check("ledger: SELLER_PAYABLE matches the seller order",
  byType.SELLER_PAYABLE === captured.seller_orders[0].seller_payable, String(byType.SELLER_PAYABLE));
check("ledger: PAYMENT_GATEWAY_FEE taken from the event",
  byType.PAYMENT_GATEWAY_FEE === 7083, String(byType.PAYMENT_GATEWAY_FEE));
const sale = (byType.PRODUCT_SALE ?? 0) + (byType.SHIPPING ?? 0);
check("ledger balances: sale = commission + payable",
  sale === (byType.SAKDHA_COMMISSION ?? 0) + (byType.SELLER_PAYABLE ?? 0),
  `${sale} vs ${(byType.SAKDHA_COMMISSION ?? 0) + (byType.SELLER_PAYABLE ?? 0)}`);

const payment = (await db.from("payments").select("status, amount").eq("razorpay_payment_id", ID.payment).maybeSingle()).data;
check("payment row recorded",
  payment?.status === "captured" && payment?.amount === captured.grand_total, JSON.stringify(payment));

// 3. Idempotency --------------------------------------------------------------
const replay = await send(captureEvent, ID.captureEvent);
check("replayed event acknowledged as duplicate",
  replay.status === 200 && replay.body?.duplicate === true, JSON.stringify(replay.body));
const ledgerAfterReplay = await ledgerFor(captured.id);
check("replay did not double the ledger",
  ledgerAfterReplay.length === ledger.length, `${ledger.length} -> ${ledgerAfterReplay.length} rows`);
const variantAfterReplay = await variant();
check("replay did not double-commit inventory",
  variantAfterReplay.inventory_qty === afterVariant.inventory_qty,
  `${afterVariant.inventory_qty} -> ${variantAfterReplay.inventory_qty}`);

// 4. payment.failed releases the hold -----------------------------------------
const beforeFail = await variant();
const failRes = await send({
  event: "payment.failed", created_at: 1791226100,
  payload: { payment: { entity: {
    id: ID.failedPayment, order_id: failing.razorpay_order_id,
    amount: failing.grand_total, status: "failed", method: "card",
  } } },
}, ID.failEvent);
check("payment.failed accepted", failRes.status === 200, JSON.stringify(failRes.body));
await wait(1500);

const afterFail = await getOrder(failOrderNo);
const variantAfterFail = await variant();
check("failed order marked FAILED/CANCELLED",
  afterFail.payment_status === "FAILED" && afterFail.order_status === "CANCELLED",
  `${afterFail.payment_status}/${afterFail.order_status}`);
check("seller_orders cancelled",
  afterFail.seller_orders.every((s) => s.status === "CANCELLED"),
  afterFail.seller_orders.map((s) => s.status).join(","));
check("held stock released, inventory untouched",
  variantAfterFail.inventory_qty === beforeFail.inventory_qty &&
  variantAfterFail.reserved_qty === beforeFail.reserved_qty - failQty,
  `inv ${beforeFail.inventory_qty}->${variantAfterFail.inventory_qty}, reserved ${beforeFail.reserved_qty}->${variantAfterFail.reserved_qty}`);

// 5. transfer.processed -------------------------------------------------------
const sellerOrderId = afterOrder.seller_orders[0].id;
const transferRes = await send({
  event: "transfer.processed", created_at: 1791226200,
  payload: { transfer: { entity: {
    id: ID.transfer, recipient: "acc_DEMO",
    amount: afterOrder.seller_orders[0].seller_payable,
    notes: { seller_order_id: sellerOrderId },
  } } },
}, ID.transferEvent);
check("transfer.processed accepted", transferRes.status === 200);
await wait(1000);
const split = (await db.from("payment_splits").select("status, amount, seller_order_id").eq("razorpay_transfer_id", ID.transfer).maybeSingle()).data;
check("payment_split reconciled to the right seller order",
  split?.seller_order_id === sellerOrderId && split?.status === "processed", JSON.stringify(split));

// 6. refund.processed ---------------------------------------------------------
const refundRes = await send({
  event: "refund.processed", created_at: 1791226300,
  payload: { refund: { entity: {
    id: ID.refund, payment_id: ID.payment,
    amount: captured.grand_total, status: "processed",
    notes: { seller_order_id: sellerOrderId },
  } } },
}, ID.refundEvent);
check("refund.processed accepted", refundRes.status === 200);
await wait(1200);
const refund = (await db.from("refunds").select("amount, status").eq("razorpay_refund_id", ID.refund).maybeSingle()).data;
check("refund row recorded", refund?.amount === captured.grand_total, JSON.stringify(refund));
const refundedOrder = await getOrder(captureOrderNo);
check("full refund flips the order to REFUNDED",
  refundedOrder.payment_status === "REFUNDED", refundedOrder.payment_status);
const refundLedger = (await ledgerFor(captured.id)).filter((e) => e.type === "REFUND");
check("ledger: REFUND entry written as a debit",
  refundLedger.length === 1 && refundLedger[0].direction === "debit", JSON.stringify(refundLedger[0]));

// 7. Unknown events are acknowledged, never retried forever --------------------
const unknown = await send({
  event: "payment.authorized",
  payload: { payment: { entity: { id: "pay_X", order_id: "order_X", amount: 1 } } },
}, ID.unknownEvent);
check("unhandled event type acknowledged with 200", unknown.status === 200, JSON.stringify(unknown.body));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
