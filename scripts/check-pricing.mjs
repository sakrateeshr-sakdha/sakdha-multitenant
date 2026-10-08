/**
 * Verification for the commission + shipping engine.
 *
 * The pricing engine decides what every customer is charged and what every
 * seller is paid, so it gets asserted rather than eyeballed. There is no test
 * runner in the project yet; this compiles lib/commerce/pricing.ts with the
 * local TypeScript and checks it directly.
 *
 * Run:  NODE_OPTIONS= node scripts/check-pricing.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakdha-pricing-"));

// `server-only` throws outside a React Server Component, and the @/ alias does
// not exist for bare tsc — strip both for the standalone compile.
fs.writeFileSync(
  path.join(outDir, "pricing.ts"),
  fs
    .readFileSync(path.join(root, "src/lib/commerce/pricing.ts"), "utf8")
    .replace('import "server-only";', "")
    .replace('from "@/lib/money"', 'from "./money.js"')
);
fs.copyFileSync(path.join(root, "src/lib/money.ts"), path.join(outDir, "money.ts"));

// Run the compiler's JS entrypoint with this same Node binary. Spawning the
// .bin/tsc.cmd shim fails with EINVAL on Windows under Node 24.
const tscEntry = path.join(root, "node_modules", "typescript", "bin", "tsc");
execFileSync(
  process.execPath,
  [
    tscEntry,
    path.join(outDir, "pricing.ts"),
    path.join(outDir, "money.ts"),
    "--module", "esnext",
    "--target", "es2022",
    "--moduleResolution", "bundler",
  ],
  { stdio: "inherit" }
);

const { buildQuote, assertQuoteBalances, computeShipping, computeCommission } = await import(
  new URL(`file:///${path.join(outDir, "pricing.js").replace(/\\/g, "/")}`).href
);

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`)
  );
  ok ? pass++ : fail++;
};

const RULE_2PC = {
  id: "r1",
  percentage: 2,
  fixed_amount: 0,
  applies_to: "PRODUCT_SUBTOTAL",
  category_id: null,
  seller_id: null,
  active: true,
  valid_from: "2020-01-01T00:00:00Z",
  valid_until: null,
};

const freeAbove = {
  seller_id: "sellerA",
  type: "FREE_ABOVE",
  flat_fee: 9900,
  free_above_threshold: 149900,
  dispatch_sla_hours: 48,
};

// --- shipping ---------------------------------------------------------------
check("FREE_ABOVE under threshold charges the flat fee", computeShipping(freeAbove, 100000), {
  shipping: 9900,
  freeShippingShortfall: 49900,
});
check("FREE_ABOVE exactly at threshold is free", computeShipping(freeAbove, 149900), {
  shipping: 0,
  freeShippingShortfall: null,
});
check("a seller with no rule ships free", computeShipping(undefined, 50000), {
  shipping: 0,
  freeShippingShortfall: null,
});

// --- commission -------------------------------------------------------------
check(
  "2% is charged on product subtotal only",
  computeCommission(RULE_2PC, { subtotal: 489900, shipping: 9900, discount: 0 }),
  9798
);
check(
  "shipping never inflates commission",
  computeCommission(RULE_2PC, { subtotal: 100000, shipping: 999900, discount: 0 }),
  2000
);
check(
  "an ORDER_TOTAL rule does include shipping",
  computeCommission(
    { ...RULE_2PC, applies_to: "ORDER_TOTAL" },
    { subtotal: 100000, shipping: 50000, discount: 0 }
  ),
  3000
);

// --- multi-store quote ------------------------------------------------------
const stores = new Map([
  ["storeA", { name: "Aaa Store", slug: "aaa" }],
  ["storeB", { name: "Bbb Store", slug: "bbb" }],
]);
const shippingRules = new Map([
  ["sellerA", freeAbove],
  [
    "sellerB",
    {
      seller_id: "sellerB",
      type: "FLAT",
      flat_fee: 5000,
      free_above_threshold: null,
      dispatch_sla_hours: 24,
    },
  ],
]);
const line = (o) => ({
  productId: o.p,
  variantId: null,
  sellerId: o.s,
  storeId: o.st,
  name: o.p,
  sku: null,
  qty: o.q,
  unitPrice: o.u,
  categoryId: "cat1",
});

const quote = buildQuote(
  [
    line({ p: "saree", s: "sellerA", st: "storeA", q: 1, u: 489900 }),
    line({ p: "kurti", s: "sellerA", st: "storeA", q: 2, u: 219900 }),
    line({ p: "shirt", s: "sellerB", st: "storeB", q: 1, u: 100000 }),
  ],
  { stores, shippingRules, commissionRules: [RULE_2PC] }
);

check("a two-seller cart fans out into two seller orders", quote.sellers.length, 2);
check("shipmentCount is what the customer is promised", quote.shipmentCount, 2);
check("subtotal sums every line", quote.subtotal, 489900 + 2 * 219900 + 100000);

const a = quote.sellers.find((s) => s.sellerId === "sellerA");
const b = quote.sellers.find((s) => s.sellerId === "sellerB");

check("seller A subtotal", a.subtotal, 929700);
check("seller A crosses the free-shipping threshold", a.shipping, 0);
check("seller A commission is 2% of goods", a.commission, 18594);
check("seller A payable is goods less commission", a.sellerPayable, 929700 - 18594);
check("seller B pays flat shipping", b.shipping, 5000);
check("seller B payable carries shipping, less commission", b.sellerPayable, 100000 + 5000 - 2000);
check("grand total is goods plus shipping", quote.grandTotal, 1029700 + 5000);
check("commission total", quote.commissionTotal, 18594 + 2000);

// --- the invariant that gates every payment ---------------------------------
try {
  assertQuoteBalances(quote);
  console.log("PASS  quote balances: seller payables + commission === amount charged");
  pass++;
} catch (error) {
  console.log(`FAIL  ${error.message}`);
  fail++;
}

// Rounding must not leak a paisa on awkward amounts.
const odd = buildQuote([line({ p: "x", s: "sellerB", st: "storeB", q: 3, u: 33333 })], {
  stores,
  shippingRules,
  commissionRules: [RULE_2PC],
});
try {
  assertQuoteBalances(odd);
  console.log(`PASS  odd amounts balance (subtotal ${odd.subtotal}, commission ${odd.commissionTotal})`);
  pass++;
} catch (error) {
  console.log(`FAIL  ${error.message}`);
  fail++;
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
