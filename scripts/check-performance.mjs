/**
 * Verifies seller performance scoring.
 *
 * These numbers drive a seller's risk banding and, eventually, enforcement —
 * so the edge cases matter: an order still inside its SLA must not count
 * against anyone, and an overdue-but-unshipped order must count immediately
 * rather than only once it finally ships.
 *
 * Run:  NODE_OPTIONS= node scripts/check-performance.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakdha-perf-"));

fs.writeFileSync(
  path.join(outDir, "performance.ts"),
  fs.readFileSync(path.join(root, "src/lib/commerce/performance.ts"), "utf8")
);
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join(outDir, "performance.ts"),
    "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  ],
  { stdio: "inherit" }
);

const { computePerformance, riskLevel } = await import(
  new URL(`file:///${path.join(outDir, "performance.js").replace(/\\/g, "/")}`).href
);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
};

const NOW = new Date("2026-10-20T00:00:00.000Z");
// `shipped: null` means genuinely not shipped, so it must NOT fall back to the
// default — `??` would treat null as "unset" and silently ship the parcel.
const order = (o = {}) => ({
  status: o.status ?? "DELIVERED",
  created_at: o.created_at ?? "2026-10-01T00:00:00.000Z",
  dispatch_deadline: "deadline" in o ? o.deadline : "2026-10-03T00:00:00.000Z",
  shipped_at: "shipped" in o ? o.shipped : "2026-10-02T00:00:00.000Z",
});

// --- empty ------------------------------------------------------------------
check("no orders scores zero across the board", computePerformance([], NOW), {
  totalOrders: 0, onTimeRate: 0, lateRate: 0, cancellationRate: 0,
  returnRate: 0, refundRate: 0, orderDefectRate: 0,
});

// --- dispatch timing ---------------------------------------------------------
const allOnTime = computePerformance([order(), order(), order(), order()], NOW);
check("all shipped before deadline -> 100% on time", allOnTime.onTimeRate, 100);
check("…and 0% late", allOnTime.lateRate, 0);
check("…and no defects", allOnTime.orderDefectRate, 0);

const oneLate = computePerformance(
  [order(), order(), order(), order({ shipped: "2026-10-05T00:00:00.000Z" })],
  NOW
);
check("one of four shipped late -> 75% on time", oneLate.onTimeRate, 75);
check("…25% late", oneLate.lateRate, 25);
check("late orders count as defects", oneLate.orderDefectRate, 25);

check("shipping exactly on the deadline is on time",
  computePerformance([order({ shipped: "2026-10-03T00:00:00.000Z" })], NOW).onTimeRate, 100);

// The important one: overdue and still not shipped.
check("overdue and unshipped counts late immediately",
  computePerformance([order({ status: "ACCEPTED", shipped: null })], NOW).lateRate, 100);

// Still inside the window: neither on time nor late, so it must not be scored.
const openOrder = computePerformance(
  [order({ status: "ACCEPTED", shipped: null, deadline: "2026-10-25T00:00:00.000Z" })],
  NOW
);
check("an order still inside its SLA is not scored late", openOrder.lateRate, 0);
check("…nor counted as on time", openOrder.onTimeRate, 0);
check("…and is not a defect", openOrder.orderDefectRate, 0);

// --- cancellations and returns ------------------------------------------------
const mixed = computePerformance(
  [order(), order(), order({ status: "CANCELLED", shipped: null }), order({ status: "RETURNED" })],
  NOW
);
check("cancellation rate over all orders", mixed.cancellationRate, 25);
check("return rate over all orders", mixed.returnRate, 25);
check("a cancelled order is excluded from dispatch scoring", mixed.onTimeRate, 100);
check("defects combine cancellations and returns", mixed.orderDefectRate, 50);

check("refund rate counts only REFUNDED",
  computePerformance([order({ status: "REFUNDED" }), order()], NOW).refundRate, 50);
check("RETURN_REQUESTED already counts as a return",
  computePerformance([order({ status: "RETURN_REQUESTED" }), order()], NOW).returnRate, 50);

// --- risk banding --------------------------------------------------------------
const band = (defect, total = 100) => riskLevel({
  totalOrders: total, onTimeRate: 0, lateRate: 0, cancellationRate: 0,
  returnRate: 0, refundRate: 0, orderDefectRate: defect,
});
check("a brand-new seller is not branded at risk", band(100, 2), "GOOD");
check("0% defects is excellent", band(0), "EXCELLENT");
check("2% is still excellent", band(2), "EXCELLENT");
check("5% is good", band(5), "GOOD");
check("10% needs improvement", band(10), "NEEDS_IMPROVEMENT");
check("above 10% is at risk", band(10.01), "AT_RISK");

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
