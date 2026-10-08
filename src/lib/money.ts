/**
 * Money is stored and computed in INTEGER PAISE (bigint in the DB, number in
 * JS where values stay well under Number.MAX_SAFE_INTEGER for realistic carts).
 * Never use floats for money math. Convert to rupees only at the display edge.
 */

/** Format paise as an INR string, e.g. 199900 -> "₹1,999". */
export function formatINR(paise: number, opts?: { withPaise?: boolean }): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: opts?.withPaise && paise % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: opts?.withPaise ? 2 : 0,
  }).format(rupees);
}

/** Rupees (as entered in a form) -> paise. Rounds to the nearest paisa. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Percentage of an amount, rounded to the nearest paisa. e.g. commission. */
export function percentOf(amountPaise: number, percent: number): number {
  return Math.round((amountPaise * percent) / 100);
}

/** Discount percent between a compare-at and current price (integer %). */
export function discountPercent(price: number, compareAt?: number | null): number | null {
  if (!compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
