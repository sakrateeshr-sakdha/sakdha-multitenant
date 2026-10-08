/**
 * Verifies the settlement engine.
 *
 * This decides what each seller is actually paid, so the arithmetic is asserted
 * rather than eyeballed — particularly the cases where naive maths overpays:
 * refunds landing in a later period, a seller's own payout being counted as
 * income, and platform-level rows leaking into a seller's total.
 *
 * Run:  NODE_OPTIONS= node scripts/check-settlement.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakdha-settlement-"));

fs.writeFileSync(
  path.join(outDir, "settlement.ts"),
  fs.readFileSync(path.join(root, "src/lib/commerce/settlement.ts"), "utf8")
);

execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join(outDir, "settlement.ts"),
    "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  ],
  { stdio: "inherit" }
);

const { settleSeller, settlePeriod, platformPosition, periodOf, periodBounds, previousPeriods } =
  await import(new URL(`file:///${path.join(outDir, "settlement.js").replace(/\\/g, "/")}`).href);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
};

const row = (type, amount, opts = {}) => ({
  type,
  amount,
  direction: opts.direction ?? "credit",
  seller_id: opts.sellerId ?? "sellerA",
  order_id: opts.orderId ?? "order1",
  created_at: "2026-10-15T00:00:00.000Z",
});

// --- periods ----------------------------------------------------------------
check("periodOf formats YYYY-MM", periodOf(new Date(Date.UTC(2026, 9, 6))), "2026-10");
check("periodOf pads single-digit months", periodOf(new Date(Date.UTC(2026, 0, 1))), "2026-01");
check("periodBounds is start-inclusive, end-exclusive", periodBounds("2026-10"), {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-11-01T00:00:00.000Z",
});
check("periodBounds rolls the year", periodBounds("2026-12").to, "2027-01-01T00:00:00.000Z");
check("previousPeriods walks backwards", previousPeriods(3, new Date(Date.UTC(2026, 0, 15))), [
  "2026-01", "2025-12", "2025-11",
]);

// --- a single clean sale ----------------------------------------------------
const sale = [
  row("PRODUCT_SALE", 219900),
  row("SHIPPING", 9900),
  row("SAKDHA_COMMISSION", 4398, { direction: "debit" }),
  row("SELLER_PAYABLE", 225402),
];
const s1 = settleSeller("sellerA", "2026-10", sale);
check("gross = goods + shipping", s1.gross, 229800);
check("commission captured", s1.commission, 4398);
check("earned uses SELLER_PAYABLE", s1.earned, 225402);
check("net payable with no refunds equals earned", s1.netPayable, 225402);
check("gross − commission reconciles to payable", s1.gross - s1.commission, s1.earned);
check("order counted once", s1.orderCount, 1);

// --- refunds reduce the payout ----------------------------------------------
const withRefund = settleSeller("sellerA", "2026-10", [...sale, row("REFUND", 100000, { direction: "debit" })]);
check("refund reduces net payable", withRefund.netPayable, 125402);
check("refund does not alter gross", withRefund.gross, 229800);

// A refund larger than the period's sales must not produce a negative payout.
const overRefunded = settleSeller("sellerA", "2026-10", [...sale, row("REFUND", 500000, { direction: "debit" })]);
check("payout never goes negative", overRefunded.netPayable, 0);
check("but the refund total is still reported", overRefunded.refunds, 500000);

// --- the traps --------------------------------------------------------------
const withPayout = settleSeller("sellerA", "2026-10", [...sale, row("SETTLEMENT", 225402, { direction: "debit" })]);
check("a SETTLEMENT payout is not treated as income", withPayout.netPayable, 225402);

const withGatewayFee = settleSeller("sellerA", "2026-10", [...sale, row("PAYMENT_GATEWAY_FEE", 7083, { direction: "debit" })]);
check("gateway fee is not deducted from the seller", withGatewayFee.netPayable, 225402);

const withDiscount = settleSeller("sellerA", "2026-10", [...sale, row("DISCOUNT", 5000, { direction: "debit" })]);
check("discount is not double-counted", withDiscount.netPayable, 225402);

const multiOrder = settleSeller("sellerA", "2026-10", [
  ...sale,
  row("SELLER_PAYABLE", 100000, { orderId: "order2" }),
]);
check("two orders counted separately", multiOrder.orderCount, 2);
check("payables accumulate", multiOrder.earned, 325402);

// --- multiple sellers in one period ------------------------------------------
const mixed = [
  ...sale,
  row("PRODUCT_SALE", 50000, { sellerId: "sellerB", orderId: "order3" }),
  row("SAKDHA_COMMISSION", 1000, { sellerId: "sellerB", orderId: "order3", direction: "debit" }),
  row("SELLER_PAYABLE", 49000, { sellerId: "sellerB", orderId: "order3" }),
  // Platform-level row with no seller attached.
  { type: "PAYMENT_GATEWAY_FEE", amount: 7083, direction: "debit", seller_id: null, order_id: "order1", created_at: "2026-10-15T00:00:00.000Z" },
];
const period = settlePeriod("2026-10", mixed);
check("one settlement per seller", period.length, 2);
check("sorted by largest payout first", period.map((p) => p.sellerId), ["sellerA", "sellerB"]);
check("seller B is not charged seller A's commission", period.find((p) => p.sellerId === "sellerB").commission, 1000);
check("platform rows excluded from seller totals",
  period.reduce((sum, p) => sum + p.gross, 0), 229800 + 50000);

const position = platformPosition(mixed, period);
check("platform commission is the sum of sellers'", position.commission, 5398);
check("platform gateway fees captured", position.gatewayFees, 7083);
check("net revenue = commission − gateway fees", position.netRevenue, 5398 - 7083);
check("owed to sellers is the sum of net payables", position.owedToSellers, 225402 + 49000);

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
