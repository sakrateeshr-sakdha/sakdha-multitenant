/**
 * Seller performance (spec §14).
 *
 * Measured against what the seller promised: `dispatch_deadline` is set from
 * their own SLA at order time, so "late" means late by their own commitment,
 * not by a platform-imposed clock.
 *
 * Rates are percentages with two decimals, matching numeric(5,2) in the DB.
 */

export type SellerOrderFact = {
  status: string;
  dispatch_deadline: string | null;
  created_at: string;
  /** When the parcel actually went out, if it did. */
  shipped_at: string | null;
};

export type Performance = {
  totalOrders: number;
  onTimeRate: number;
  lateRate: number;
  cancellationRate: number;
  returnRate: number;
  refundRate: number;
  /** Order defect rate: the share of orders that went wrong for the customer. */
  orderDefectRate: number;
};

const RETURNED = new Set(["RETURN_REQUESTED", "RETURNED", "REFUNDED"]);
const DISPATCHED = new Set(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURN_REQUESTED", "RETURNED", "REFUNDED"]);

const rate = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 10000) / 100;

/**
 * `now` is injected rather than read from the clock so the calculation is
 * deterministic and testable — and so an overdue-but-unshipped order counts as
 * late the moment its deadline passes, not only once it eventually ships.
 */
export function computePerformance(orders: SellerOrderFact[], now: Date): Performance {
  const total = orders.length;
  if (total === 0) {
    return {
      totalOrders: 0,
      onTimeRate: 0,
      lateRate: 0,
      cancellationRate: 0,
      returnRate: 0,
      refundRate: 0,
      orderDefectRate: 0,
    };
  }

  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;
  const returned = orders.filter((o) => RETURNED.has(o.status)).length;
  const refunded = orders.filter((o) => o.status === "REFUNDED").length;

  // Dispatch performance only makes sense for orders with a deadline that are
  // not cancelled — a cancelled order was never going to ship.
  const dispatchable = orders.filter((o) => o.status !== "CANCELLED" && o.dispatch_deadline);
  let onTime = 0;
  let late = 0;

  for (const order of dispatchable) {
    const deadline = new Date(order.dispatch_deadline!).getTime();
    if (order.shipped_at) {
      if (new Date(order.shipped_at).getTime() <= deadline) onTime++;
      else late++;
    } else if (now.getTime() > deadline) {
      // Not shipped and past the deadline: already late, not merely pending.
      late++;
    }
    // Still within the window and unshipped: neither, it is simply open.
  }

  const measured = onTime + late;

  return {
    totalOrders: total,
    onTimeRate: rate(onTime, measured),
    lateRate: rate(late, measured),
    cancellationRate: rate(cancelled, total),
    returnRate: rate(returned, total),
    refundRate: rate(refunded, total),
    // What a customer would call "went wrong": seller cancelled it, it came
    // back, or it was dispatched late.
    orderDefectRate: rate(cancelled + returned + late, total),
  };
}

/** Risk banding driven by the defect rate (spec §14). */
export function riskLevel(p: Performance): "EXCELLENT" | "GOOD" | "NEEDS_IMPROVEMENT" | "AT_RISK" {
  // Too little history to judge — do not brand a new seller as at risk.
  if (p.totalOrders < 5) return "GOOD";
  if (p.orderDefectRate <= 2) return "EXCELLENT";
  if (p.orderDefectRate <= 5) return "GOOD";
  if (p.orderDefectRate <= 10) return "NEEDS_IMPROVEMENT";
  return "AT_RISK";
}
