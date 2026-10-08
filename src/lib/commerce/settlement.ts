/**
 * Settlement: turning the ledger into "what Sakdha owes each seller".
 *
 * The ledger is the source of truth, not the orders table. Orders tell you what
 * was agreed; the ledger records what actually moved, including refunds that
 * landed long after the sale. Computing settlement from anything else means
 * paying a seller for an order that was later refunded.
 *
 * Pure functions, so the arithmetic can be tested without a database.
 * All amounts are integer paise.
 */

export type LedgerRow = {
  type: string;
  amount: number;
  direction: "debit" | "credit";
  seller_id: string | null;
  order_id: string | null;
  created_at: string;
};

export type SellerSettlement = {
  sellerId: string;
  period: string;
  /** Product value + shipping the seller charged. */
  gross: number;
  /** Sakdha's cut, already deducted from seller_payable. */
  commission: number;
  /** Refunds charged back to this seller in the period. */
  refunds: number;
  /** The payable figure before refunds — what the sales alone earned. */
  earned: number;
  /** What is actually owed: earned − refunds. Never below zero. */
  netPayable: number;
  orderCount: number;
};

/** 'YYYY-MM' for a date. */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Inclusive start, exclusive end, as ISO strings — the window for a period. */
export function periodBounds(period: string): { from: string; to: string } {
  const [year, month] = period.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function previousPeriods(count: number, now: Date): string[] {
  const periods: string[] = [];
  for (let i = 0; i < count; i++) {
    periods.push(periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return periods;
}

/**
 * Folds one seller's ledger rows for a period into a settlement.
 *
 * SELLER_PAYABLE is used rather than re-deriving from gross − commission: the
 * payable figure is what the order actually committed to, so if the commission
 * rule changed mid-period the seller is still paid what they were promised.
 */
export function settleSeller(
  sellerId: string,
  period: string,
  rows: LedgerRow[]
): SellerSettlement {
  let gross = 0;
  let commission = 0;
  let refunds = 0;
  let earned = 0;
  const orders = new Set<string>();

  for (const row of rows) {
    // Count the orders that actually earned money in the period, so a refund
    // arriving later does not inflate the order count a second time.
    if (row.order_id && row.type === "SELLER_PAYABLE") orders.add(row.order_id);

    switch (row.type) {
      case "PRODUCT_SALE":
      case "SHIPPING":
        gross += row.amount;
        break;
      case "SAKDHA_COMMISSION":
        commission += row.amount;
        break;
      case "SELLER_PAYABLE":
        earned += row.amount;
        break;
      case "REFUND":
      case "REFUND_ADJUSTMENT":
        refunds += row.amount;
        break;
      case "DISCOUNT":
        // Seller-funded discounts already reduce SELLER_PAYABLE; counting them
        // again here would deduct twice.
        break;
      // SETTLEMENT records a payout leaving Sakdha, and PAYMENT_GATEWAY_FEE is
      // a platform cost with no seller attached. Counting either here would
      // deduct a seller's own payout from their next period's earnings.
      default:
        break;
    }
  }

  return {
    sellerId,
    period,
    gross,
    commission,
    refunds,
    earned,
    // A period whose refunds exceed its sales must not produce a negative
    // payout. The excess is carried by reconciliation, not clawed back here.
    netPayable: Math.max(0, earned - refunds),
    orderCount: orders.size,
  };
}

/** Groups mixed ledger rows by seller and settles each. */
export function settlePeriod(
  period: string,
  rows: LedgerRow[]
): SellerSettlement[] {
  const bySeller = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    if (!row.seller_id) continue; // platform-level rows (gateway fees) are not a seller's
    const existing = bySeller.get(row.seller_id);
    if (existing) existing.push(row);
    else bySeller.set(row.seller_id, [row]);
  }

  return [...bySeller.entries()]
    .map(([sellerId, sellerRows]) => settleSeller(sellerId, period, sellerRows))
    .sort((a, b) => b.netPayable - a.netPayable);
}

/**
 * Sakdha's own position for a period: commission earned, gateway fees paid,
 * and what is owed out to sellers.
 */
export function platformPosition(rows: LedgerRow[], settlements: SellerSettlement[]) {
  const gatewayFees = rows
    .filter((r) => r.type === "PAYMENT_GATEWAY_FEE")
    .reduce((sum, r) => sum + r.amount, 0);

  const commission = settlements.reduce((sum, s) => sum + s.commission, 0);
  const owed = settlements.reduce((sum, s) => sum + s.netPayable, 0);
  const gross = settlements.reduce((sum, s) => sum + s.gross, 0);

  return {
    gross,
    commission,
    gatewayFees,
    /** Commission less what the gateway took. */
    netRevenue: commission - gatewayFees,
    owedToSellers: owed,
  };
}
