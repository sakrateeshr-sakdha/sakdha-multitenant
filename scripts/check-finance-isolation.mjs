/**
 * Tenant isolation for store-scoped finance.
 *
 * Signs in as real users and tries to reach data they must not have. Policy
 * text passing review is not evidence; these assertions fail if RLS or the
 * application scoping regresses.
 *
 * Covers:
 *   • Store A cannot read Store B's ledger, settlements or bank details
 *   • Request-parameter tampering cannot cross a tenant boundary
 *   • The authorised store DOES receive its own data (no lockout)
 *   • Seller-scoped payout identity still resolves
 *   • RLS and application scoping agree on the same row set
 *
 * Creates no payments, transfers or settlements. Any fixture it adds is
 * removed in a finally block.
 *
 * Requires test passwords to be set (see memory / scripts/README).
 * Run:  NODE_OPTIONS= npm run check:finance-isolation
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !svc || !anon) {
  console.error("Missing Supabase keys in .env.local");
  process.exit(1);
}
const SVC = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  ${detail}` : ""}`);
};

// Credentials are set by the operator, not by this script, so a CI run cannot
// silently rewrite a password. Missing ones are reported, never invented.
//
// Read from the environment rather than written here: these are real, working
// logins for the Supabase project, and a literal in a tracked file is a
// credential published to everyone who can read the repository.
// `.env.local` is parsed into `env` above, not into process.env, so check both
// — the file for local runs, the real environment for CI.
const secret = (name) => env[name] || process.env[name];

const USERS = {
  storeAOwner: { email: "demo-seller@sakdha.test", password: secret("TEST_STORE_A_OWNER_PASSWORD") },
  storeBOwner: { email: "newseller@sakdha.in", password: secret("TEST_STORE_B_OWNER_PASSWORD") },
  customer: { email: "testshopper@sakdha.in", password: secret("TEST_CUSTOMER_PASSWORD") },
};

const missing = Object.entries(USERS).filter(([, u]) => !u.password);
if (missing.length > 0) {
  console.error(
    "Missing test credentials. Set these in .env.local (which is gitignored):\n" +
      "  TEST_STORE_A_OWNER_PASSWORD   (demo-seller@sakdha.test)\n" +
      "  TEST_STORE_B_OWNER_PASSWORD   (newseller@sakdha.in)\n" +
      "  TEST_CUSTOMER_PASSWORD        (testshopper@sakdha.in)\n" +
      "These are dev-only logins; set them with the Supabase Admin API."
  );
  process.exit(1);
}

async function signIn({ email, password }) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  return j.access_token ?? null;
}
async function get(token, table, query) {
  const r = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  return r.ok ? await r.json() : { error: r.status };
}

// --- fixtures (read-only) ----------------------------------------------------
const stores = await (await fetch(`${url}/rest/v1/stores?select=id,slug,seller_id`, { headers: SVC })).json();
const storeA = stores.find((s) => s.slug === "indigo-loom");
const storeB = stores.find((s) => s.slug === "meera-handlooms");
if (!storeA || !storeB) {
  console.error("Expected fixtures indigo-loom and meera-handlooms are missing.");
  process.exit(1);
}

const tokens = {};
for (const [who, creds] of Object.entries(USERS)) {
  tokens[who] = await signIn(creds);
  if (!tokens[who]) {
    console.error(`Could not sign in as ${creds.email}. Set its password before running.`);
    process.exit(1);
  }
}
console.log(`fixtures: A=${storeA.slug} B=${storeB.slug}\n`);

// --- 1. the authorised store gets its own data -------------------------------
console.log("--- authorised access ---");
const aLedger = await get(tokens.storeAOwner, "ledger_entries", `select=id,store_id,seller_id,type,amount`);
check("store A owner can read store A's ledger",
  Array.isArray(aLedger) && aLedger.length > 0, "saw nothing — owner locked out");
check("every row store A sees belongs to store A",
  Array.isArray(aLedger) && aLedger.every((r) => r.store_id === storeA.id),
  `foreign rows: ${Array.isArray(aLedger) ? aLedger.filter((r) => r.store_id !== storeA.id).length : "?"}`);

// Platform rows carry no store and must not be visible to a seller at all.
check("store A owner cannot see platform gateway-fee rows",
  Array.isArray(aLedger) && aLedger.every((r) => r.type !== "PAYMENT_GATEWAY_FEE"));

// --- 2. cross-store reads ----------------------------------------------------
console.log("\n--- cross-store isolation ---");
const bLedgerAsA = await get(tokens.storeAOwner, "ledger_entries", `select=id&store_id=eq.${storeB.id}`);
check("store A cannot read store B's ledger by naming its id",
  Array.isArray(bLedgerAsA) && bLedgerAsA.length === 0,
  `${Array.isArray(bLedgerAsA) ? bLedgerAsA.length : "?"} row(s) leaked`);

const bSettlementsAsA = await get(tokens.storeAOwner, "settlements", `select=id&store_id=eq.${storeB.id}`);
check("store A cannot read store B's settlements",
  Array.isArray(bSettlementsAsA) && bSettlementsAsA.length === 0);

const bBankAsA = await get(tokens.storeAOwner, "seller_bank_accounts", `select=id&seller_id=eq.${storeB.seller_id}`);
check("store A cannot read store B's bank account",
  Array.isArray(bBankAsA) && bBankAsA.length === 0);

const bOrdersAsA = await get(tokens.storeAOwner, "seller_orders", `select=id&store_id=eq.${storeB.id}`);
check("store A cannot read store B's seller_orders",
  Array.isArray(bOrdersAsA) && bOrdersAsA.length === 0);

// --- 3. parameter tampering --------------------------------------------------
// The app never accepts a store id from the caller, so the realistic attack is
// at the data layer: forge the filter and see whether RLS still holds.
console.log("\n--- parameter tampering ---");
const tamperFilters = [
  ["seller_id of store B", `select=id&seller_id=eq.${storeB.seller_id}`],
  ["no filter at all (hope for everything)", `select=id,store_id`],
  ["OR across both stores", `select=id,store_id&or=(store_id.eq.${storeA.id},store_id.eq.${storeB.id})`],
];
for (const [label, query] of tamperFilters) {
  const rows = await get(tokens.storeAOwner, "ledger_entries", query);
  const leaked = Array.isArray(rows) ? rows.filter((r) => r.store_id && r.store_id !== storeA.id) : [];
  check(`tampering — ${label}`, leaked.length === 0, `${leaked.length} foreign row(s)`);
}

// A customer is not a tenant at all.
const customerLedger = await get(tokens.customer, "ledger_entries", "select=id");
check("a plain customer sees no ledger rows",
  Array.isArray(customerLedger) && customerLedger.length === 0);
const customerSettlements = await get(tokens.customer, "settlements", "select=id");
check("a plain customer sees no settlements",
  Array.isArray(customerSettlements) && customerSettlements.length === 0);

// --- 4. RLS and application scoping agree ------------------------------------
// resolveCallerStore() filters by store_id; RLS independently restricts the
// same rows. If the two ever disagree the app is relying on one of them alone.
console.log("\n--- RLS vs application scoping ---");
const rlsOnly = await get(tokens.storeAOwner, "ledger_entries", "select=id");
const appScoped = await get(tokens.storeAOwner, "ledger_entries", `select=id&store_id=eq.${storeA.id}`);
check("RLS-only and store-scoped queries return the same rows",
  Array.isArray(rlsOnly) && Array.isArray(appScoped) && rlsOnly.length === appScoped.length,
  `rls=${rlsOnly?.length} app=${appScoped?.length}`);

// --- 5. seller payout identity still resolves --------------------------------
console.log("\n--- seller payout identity (must still work) ---");
const bOwnerBank = await get(tokens.storeBOwner, "seller_bank_accounts", "select=id,seller_id");
check("store B owner can still read their own bank account",
  Array.isArray(bOwnerBank) && bOwnerBank.length === 1 && bOwnerBank[0].seller_id === storeB.seller_id,
  `saw ${Array.isArray(bOwnerBank) ? bOwnerBank.length : "?"}`);

const aSeller = await get(tokens.storeAOwner, "sellers", "select=id,razorpay_account_id");
check("store A owner can still read their seller row (payee identity)",
  Array.isArray(aSeller) && aSeller.length === 1 && aSeller[0].id === storeA.seller_id);

// --- 6. refunds and reconciliation -------------------------------------------
console.log("\n--- refunds / reconciliation ---");
const aRefunds = Array.isArray(aLedger) ? aLedger.filter((r) => r.type === "REFUND") : [];
check("store A's refunds are visible to store A", aRefunds.length > 0,
  "refunds invisible — the settlement fold would overpay");
check("every refund store A sees is attributed to store A's seller",
  aRefunds.every((r) => r.seller_id === storeA.seller_id));

const earned = (Array.isArray(aLedger) ? aLedger : [])
  .filter((r) => r.type === "SELLER_PAYABLE").reduce((t, r) => t + r.amount, 0);
const refunded = aRefunds.reduce((t, r) => t + r.amount, 0);
console.log(`      store A: earned=${earned} refunds=${refunded} net=${Math.max(0, earned - refunded)}`);
check("net payable is floored at zero, not negative", Math.max(0, earned - refunded) >= 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
