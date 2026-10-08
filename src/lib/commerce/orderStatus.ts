/**
 * Shared between server and client on purpose — this is a pure state machine
 * with no secrets and no data access, and the seller's fulfilment controls need
 * the same transition rules the server enforces. The server still re-checks
 * every transition; the client copy only decides which buttons to show.
 *
 * Parent order status is derived, never set by hand.
 *
 * One order fans out to N seller_orders that progress independently — one store
 * can have delivered while another hasn't shipped. The parent therefore has
 * PARTIALLY_* states, and recomputing it from the children is the only way it
 * stays truthful.
 */

export type SellerOrderStatus =
  | "NEW"
  | "ACCEPTED"
  | "PROCESSING"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURN_REQUESTED"
  | "RETURNED"
  | "REFUNDED";

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PARTIALLY_PROCESSING"
  | "PROCESSING"
  | "PARTIALLY_SHIPPED"
  | "SHIPPED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "CANCELLED"
  | "PARTIALLY_CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

/** What a seller may move a child order to, from where. */
const ALLOWED: Record<string, SellerOrderStatus[]> = {
  NEW: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  RETURN_REQUESTED: ["RETURNED"],
  RETURNED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: string, to: SellerOrderStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function nextStatuses(from: string): SellerOrderStatus[] {
  return ALLOWED[from] ?? [];
}

const DELIVERED_SET = new Set(["DELIVERED"]);
const SHIPPED_SET = new Set(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"]);
const PROCESSING_SET = new Set([
  "ACCEPTED",
  "PROCESSING",
  "READY_TO_SHIP",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);

/**
 * Rolls child statuses up into the parent.
 *
 * Checked most-advanced first, and "all" before "some", so a mixed order lands
 * on the PARTIALLY_* state rather than overstating progress. Cancelled children
 * are excluded from the progress maths — an order with one cancelled package
 * and one delivered package is DELIVERED for what remains, not stuck.
 */
export function rollUpOrderStatus(
  childStatuses: string[],
  current: OrderStatus
): OrderStatus {
  if (childStatuses.length === 0) return current;

  // Payment state is owned by the payment flow, not by fulfilment.
  if (current === "PENDING_PAYMENT" || current === "REFUNDED") return current;

  const total = childStatuses.length;
  const cancelled = childStatuses.filter((s) => s === "CANCELLED").length;
  if (cancelled === total) return "CANCELLED";

  const live = childStatuses.filter((s) => s !== "CANCELLED");
  const liveTotal = live.length;
  const count = (set: Set<string>) => live.filter((s) => set.has(s)).length;

  const delivered = count(DELIVERED_SET);
  const shipped = count(SHIPPED_SET);
  const processing = count(PROCESSING_SET);

  let status: OrderStatus;
  if (delivered === liveTotal) status = "DELIVERED";
  else if (delivered > 0) status = "PARTIALLY_DELIVERED";
  else if (shipped === liveTotal) status = "SHIPPED";
  else if (shipped > 0) status = "PARTIALLY_SHIPPED";
  else if (processing === liveTotal) status = "PROCESSING";
  else if (processing > 0) status = "PARTIALLY_PROCESSING";
  else status = "PAID";

  // Some packages cancelled but not all: say so, unless the rest are finished.
  if (cancelled > 0 && status !== "DELIVERED") return "PARTIALLY_CANCELLED";
  return status;
}

/** Human labels, used by both the seller and customer views. */
export const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  ACCEPTED: "Accepted",
  PROCESSING: "Preparing",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
};
