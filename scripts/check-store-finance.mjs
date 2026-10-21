/**
 * Store-scoped finance: migration validation and reconciliation.
 *
 * Asserts the acceptance criteria for migrations 0013-0016 against the live
 * database. Safe to run at any stage: it detects which migrations are applied
 * and reports what is still outstanding rather than failing confusingly.
 *
 * Reads only. Creates no payments, transfers or settlements.
 *
 * Run:  NODE_OPTIONS= npm run check:store-finance
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
if (!url || !svc) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const H = { apikey: svc, Authorization: `Bearer ${svc}` };

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok === "skip") {
    skip++;
    console.log(`SKIP  ${label}${detail ? `  (${detail})` : ""}`);
    return;
  }
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  ${detail}` : ""}`);
};

async function rows(table, query = "select=*") {
  const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: H });
  if (!r.ok) return { error: await r.text(), status: r.status };
  return { data: await r.json() };
}
async function hasColumn(table, column) {
  const r = await fetch(`${url}/rest/v1/${table}?select=${column}&limit=0`, { headers: H });
  return r.ok;
}

// ---------------------------------------------------------------------------
// Which migrations are in?
// ---------------------------------------------------------------------------
const applied = {
  m0013: (await hasColumn("ledger_entries", "store_id")) && (await hasColumn("settlements", "store_id")),
  m0016: await hasColumn("store_members", "can_manage_payouts"),
};
console.log(`0013 (store_id columns): ${applied.m0013 ? "applied" : "NOT APPLIED"}`);
console.log(`0016 (payout authz):     ${applied.m0016 ? "applied" : "NOT APPLIED"}`);
console.log("");

const stores = (await rows("stores", "select=id,slug,seller_id,status")).data ?? [];
const sellers = (await rows("sellers", "select=id,status,razorpay_account_id")).data ?? [];
const sellerOrders = (await rows("seller_orders", "select=id,order_id,seller_id,store_id")).data ?? [];
const storeById = new Map(stores.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// 1. One-to-one store <-> seller  (acceptance criteria 1 & 2)
// ---------------------------------------------------------------------------
console.log("--- mapping ---");
const bySeller = new Map();
for (const s of stores) bySeller.set(s.seller_id, (bySeller.get(s.seller_id) ?? 0) + 1);
const multi = [...bySeller.entries()].filter(([, n]) => n > 1);
check("every seller owns at most one store", multi.length === 0, `${multi.length} seller(s) own several`);

const unresolvable = stores.filter((s) => !s.seller_id || !sellers.some((x) => x.id === s.seller_id));
check("every store resolves to a real seller", unresolvable.length === 0,
  unresolvable.map((s) => s.slug).join(", "));

const activeNoSeller = stores.filter((s) => s.status === "ACTIVE" && !s.seller_id);
check("no ACTIVE store without a seller", activeNoSeller.length === 0);

// ---------------------------------------------------------------------------
// 2. store_id / seller_id agree on every financial row  (criterion 4)
// ---------------------------------------------------------------------------
console.log("\n--- store/seller consistency ---");
const soMismatch = sellerOrders.filter((r) => {
  const st = storeById.get(r.store_id);
  return !st || st.seller_id !== r.seller_id;
});
check("seller_orders: store and seller agree", soMismatch.length === 0,
  `${soMismatch.length} mismatched`);

if (applied.m0013) {
  const ledger = (await rows("ledger_entries",
    "select=id,type,amount,seller_id,store_id,seller_order_id,order_id,created_at")).data ?? [];
  const settlements = (await rows("settlements", "select=id,seller_id,store_id,period,status,net_payable")).data ?? [];

  const lMismatch = ledger.filter((r) => {
    if (!r.store_id || !r.seller_id) return false;
    const st = storeById.get(r.store_id);
    return !st || st.seller_id !== r.seller_id;
  });
  check("ledger_entries: store and seller agree", lMismatch.length === 0, `${lMismatch.length} mismatched`);

  const stMismatch = settlements.filter((r) => {
    if (!r.store_id) return false;
    const st = storeById.get(r.store_id);
    return !st || st.seller_id !== r.seller_id;
  });
  check("settlements: store and seller agree", stMismatch.length === 0, `${stMismatch.length} mismatched`);

  // ---- attribution completeness (criteria 3 & 5) ----
  console.log("\n--- attribution ---");
  const PLATFORM = "PAYMENT_GATEWAY_FEE";
  const unattributed = ledger.filter((r) => !r.store_id && r.type !== PLATFORM);
  check("every non-platform ledger row has a store", unattributed.length === 0,
    unattributed.map((r) => `${r.type}:${r.id.slice(0, 8)}`).join(", "));

  const halfFilled = ledger.filter((r) => Boolean(r.store_id) !== Boolean(r.seller_id));
  check("no half-attributed ledger rows (one id without the other)", halfFilled.length === 0,
    halfFilled.map((r) => r.type).join(", "));

  const platformRows = ledger.filter((r) => r.type === PLATFORM);
  check("platform rows carry neither id",
    platformRows.every((r) => !r.store_id && !r.seller_id),
    `${platformRows.filter((r) => r.store_id || r.seller_id).length} wrongly attributed`);

  const settlementsNoStore = settlements.filter((r) => !r.store_id);
  check("every settlement has a store", settlementsNoStore.length === 0,
    `${settlementsNoStore.length} without`);

  // ---- the refund bug (criterion 6 / reconciliation) ----
  console.log("\n--- refunds ---");
  const refunds = ledger.filter((r) => r.type === "REFUND" || r.type === "REFUND_ADJUSTMENT");
  const orphanRefunds = refunds.filter((r) => !r.seller_id);
  check("every refund is attributed to a seller", orphanRefunds.length === 0,
    `${orphanRefunds.length} orphaned — these are INVISIBLE to settlement and overpay the seller`);

  const refundsWithSO = refunds.filter((r) => r.seller_order_id);
  const refundOwnerOk = refundsWithSO.every((r) => {
    const so = sellerOrders.find((x) => x.id === r.seller_order_id);
    return so && so.seller_id === r.seller_id && so.store_id === r.store_id;
  });
  check("refund owner matches its seller_order", refundOwnerOk);

  // ---- reconciliation totals ----
  console.log("\n--- reconciliation (paise) ---");
  const sum = (rs) => rs.reduce((t, r) => t + r.amount, 0);
  const byType = {};
  for (const r of ledger) byType[r.type] = (byType[r.type] ?? 0) + r.amount;
  for (const [t, amount] of Object.entries(byType).sort()) {
    console.log(`      ${t.padEnd(20)} ${String(amount).padStart(10)}`);
  }

  // Per store: payable earned minus refunds is what settlement would pay.
  console.log("\n      per-store position:");
  for (const st of stores) {
    const mine = ledger.filter((r) => r.store_id === st.id);
    const earned = sum(mine.filter((r) => r.type === "SELLER_PAYABLE"));
    const refunded = sum(mine.filter((r) => r.type === "REFUND" || r.type === "REFUND_ADJUSTMENT"));
    const paidOut = sum(mine.filter((r) => r.type === "SETTLEMENT"));
    console.log(
      `      ${st.slug.padEnd(18)} earned=${String(earned).padStart(8)} refunds=${String(refunded).padStart(8)} ` +
      `net=${String(Math.max(0, earned - refunded)).padStart(8)} alreadyPaid=${String(paidOut).padStart(8)}`
    );
  }

  // Commission + payable must reconstruct product sale + shipping.
  const productSale = byType.PRODUCT_SALE ?? 0;
  const shipping = byType.SHIPPING ?? 0;
  const discount = byType.DISCOUNT ?? 0;
  const commission = byType.SAKDHA_COMMISSION ?? 0;
  const payable = byType.SELLER_PAYABLE ?? 0;
  check("ledger balances: payable + commission == sales + shipping - discount",
    payable + commission === productSale + shipping - discount,
    `${payable} + ${commission} != ${productSale} + ${shipping} - ${discount}`);
} else {
  check("ledger/settlement store attribution", "skip", "0013 not applied yet");
}

// ---------------------------------------------------------------------------
// 3. Payout authorization  (criterion 8)
// ---------------------------------------------------------------------------
console.log("\n--- payout authorization ---");
if (applied.m0016) {
  const members = (await rows("store_members", "select=store_id,profile_id,role,can_manage_payouts")).data ?? [];
  const owners = members.filter((m) => m.role === "owner");
  check("every store owner may manage payouts", owners.every((m) => m.can_manage_payouts));

  const nonOwnerGranted = members.filter((m) => m.role !== "owner" && m.can_manage_payouts);
  check("no non-owner holds the grant implicitly", nonOwnerGranted.length === 0,
    `${nonOwnerGranted.length} granted — verify each was deliberate`);

  const storesWithoutPayoutManager = stores.filter(
    (s) => !members.some((m) => m.store_id === s.id && (m.role === "owner" || m.can_manage_payouts))
  );
  check("every store has someone who can manage payouts", storesWithoutPayoutManager.length === 0,
    storesWithoutPayoutManager.map((s) => s.slug).join(", "));
} else {
  check("payout grant model", "skip", "0016 not applied yet");
}

// ---------------------------------------------------------------------------
// 4. Secrets never leak through the API  (criterion: sensitive data)
// ---------------------------------------------------------------------------
console.log("\n--- secrets ---");
const bank = await rows("seller_bank_accounts", "select=*");
if (bank.data) {
  const leaked = bank.data.filter((b) =>
    Object.entries(b).some(([k, v]) =>
      k !== "account_number_enc" && typeof v === "string" && /^\d{9,18}$/.test(v)
    )
  );
  check("no plaintext account number in any bank column", leaked.length === 0);
  check("account_number_enc is actually encrypted",
    bank.data.every((b) => !/^\d+$/.test(String(b.account_number_enc ?? ""))));
} else {
  check("bank account inspection", "skip", bank.error?.slice(0, 40));
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
