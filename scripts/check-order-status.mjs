/**
 * Verifies the parent-order roll-up and the seller transition table.
 *
 * A marketplace order is only as honest as this function: it decides whether a
 * customer with two packages sees "shipped" or "partially shipped", and
 * overstating progress is a support ticket every time.
 *
 * Run:  NODE_OPTIONS= node scripts/check-order-status.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakdha-status-"));

fs.writeFileSync(
  path.join(outDir, "orderStatus.ts"),
  fs.readFileSync(path.join(root, "src/lib/commerce/orderStatus.ts"), "utf8")
    .replace('import "server-only";', "")
);

execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join(outDir, "orderStatus.ts"),
    "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  ],
  { stdio: "inherit" }
);

const { rollUpOrderStatus, canTransition, nextStatuses } = await import(
  new URL(`file:///${path.join(outDir, "orderStatus.js").replace(/\\/g, "/")}`).href
);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
};

const roll = (children, current = "PAID") => rollUpOrderStatus(children, current);

// --- single package ---------------------------------------------------------
check("one package, new -> PAID", roll(["NEW"]), "PAID");
check("one package, accepted -> PROCESSING", roll(["ACCEPTED"]), "PROCESSING");
check("one package, shipped -> SHIPPED", roll(["SHIPPED"]), "SHIPPED");
check("one package, delivered -> DELIVERED", roll(["DELIVERED"]), "DELIVERED");
check("one package, cancelled -> CANCELLED", roll(["CANCELLED"]), "CANCELLED");

// --- two packages, the whole point of the marketplace ------------------------
check("both shipped -> SHIPPED", roll(["SHIPPED", "SHIPPED"]), "SHIPPED");
check("one shipped, one preparing -> PARTIALLY_SHIPPED", roll(["SHIPPED", "PROCESSING"]), "PARTIALLY_SHIPPED");
check("both delivered -> DELIVERED", roll(["DELIVERED", "DELIVERED"]), "DELIVERED");
check("one delivered, one shipped -> PARTIALLY_DELIVERED", roll(["DELIVERED", "SHIPPED"]), "PARTIALLY_DELIVERED");
check("both accepted -> PROCESSING", roll(["ACCEPTED", "PROCESSING"]), "PROCESSING");
check("one accepted, one untouched -> PARTIALLY_PROCESSING", roll(["ACCEPTED", "NEW"]), "PARTIALLY_PROCESSING");
check("neither touched -> PAID", roll(["NEW", "NEW"]), "PAID");

// out_for_delivery counts as shipped, not delivered
check("out for delivery counts as shipped", roll(["OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY"]), "SHIPPED");

// --- cancellation does not stall the rest -----------------------------------
check("all cancelled -> CANCELLED", roll(["CANCELLED", "CANCELLED"]), "CANCELLED");
check("one cancelled, one shipped -> PARTIALLY_CANCELLED", roll(["CANCELLED", "SHIPPED"]), "PARTIALLY_CANCELLED");
check("one cancelled, rest delivered -> DELIVERED", roll(["CANCELLED", "DELIVERED"]), "DELIVERED");
check("cancelled is excluded from progress maths", roll(["CANCELLED", "NEW"]), "PARTIALLY_CANCELLED");

// --- payment state is never overwritten by fulfilment ------------------------
check("unpaid order stays PENDING_PAYMENT", roll(["NEW"], "PENDING_PAYMENT"), "PENDING_PAYMENT");
check("refunded order stays REFUNDED", roll(["DELIVERED"], "REFUNDED"), "REFUNDED");
check("no children leaves status untouched", roll([], "PAID"), "PAID");

// --- transition table --------------------------------------------------------
check("NEW -> ACCEPTED allowed", canTransition("NEW", "ACCEPTED"), true);
check("NEW -> DELIVERED refused", canTransition("NEW", "DELIVERED"), false);
check("NEW -> SHIPPED refused (must go through ready-to-ship)", canTransition("NEW", "SHIPPED"), false);
check("READY_TO_SHIP -> SHIPPED allowed", canTransition("READY_TO_SHIP", "SHIPPED"), true);
check("SHIPPED -> DELIVERED allowed", canTransition("SHIPPED", "DELIVERED"), true);
check("DELIVERED is terminal", nextStatuses("DELIVERED"), []);
check("CANCELLED is terminal", nextStatuses("CANCELLED"), []);
check("shipped order cannot be cancelled", canTransition("SHIPPED", "CANCELLED"), false);
check("delivered cannot go backwards", canTransition("DELIVERED", "SHIPPED"), false);

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
