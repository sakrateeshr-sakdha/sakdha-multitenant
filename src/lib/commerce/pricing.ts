import "server-only";
import { percentOf } from "@/lib/money";

/**
 * The commission + shipping engine. Every rupee the customer is charged, and
 * every rupee a seller is paid, is computed here from database rows — never
 * from anything the client sent. The client may send product ids and
 * quantities; nothing else it says about money is trusted.
 *
 * All amounts are integer paise.
 */

export type CommissionRule = {
  id: string;
  percentage: number;
  fixed_amount: number;
  applies_to: "PRODUCT_SUBTOTAL" | "ORDER_TOTAL" | "SHIPPING";
  category_id: string | null;
  seller_id: string | null;
  active: boolean;
  valid_from: string;
  valid_until: string | null;
};

export type ShippingRule = {
  seller_id: string;
  type: "FREE" | "FLAT" | "FREE_ABOVE";
  flat_fee: number;
  free_above_threshold: number | null;
  dispatch_sla_hours: number;
};

export type QuoteLine = {
  productId: string;
  variantId: string | null;
  sellerId: string;
  storeId: string;
  name: string;
  sku: string | null;
  qty: number;
  /** Server-read unit price (variant override or product price). */
  unitPrice: number;
  categoryId: string | null;
};

export type SellerQuote = {
  sellerId: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  lines: (QuoteLine & { lineTotal: number })[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  commission: number;
  /** What the seller receives: goods + shipping − discount − commission. */
  sellerPayable: number;
  dispatchSlaHours: number;
  freeShippingShortfall: number | null;
};

export type Quote = {
  sellers: SellerQuote[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  commissionTotal: number;
  grandTotal: number;
  shipmentCount: number;
};

/**
 * Most specific rule wins: seller+category → seller → category → global.
 * Ties break toward the most recently valid rule.
 */
export function selectCommissionRule(
  rules: CommissionRule[],
  opts: { sellerId: string; categoryId: string | null }
): CommissionRule | null {
  const now = Date.now();
  const applicable = rules.filter((r) => {
    if (!r.active) return false;
    if (new Date(r.valid_from).getTime() > now) return false;
    if (r.valid_until && new Date(r.valid_until).getTime() < now) return false;
    if (r.seller_id && r.seller_id !== opts.sellerId) return false;
    if (r.category_id && r.category_id !== opts.categoryId) return false;
    return true;
  });

  const score = (r: CommissionRule) => (r.seller_id ? 2 : 0) + (r.category_id ? 1 : 0);
  return (
    applicable.sort(
      (a, b) =>
        score(b) - score(a) ||
        new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
    )[0] ?? null
  );
}

/** Shipping for one seller's basket, per that seller's rule. */
export function computeShipping(rule: ShippingRule | undefined, subtotal: number) {
  if (!rule || rule.type === "FREE") {
    return { shipping: 0, freeShippingShortfall: null };
  }
  if (rule.type === "FLAT") {
    return { shipping: rule.flat_fee, freeShippingShortfall: null };
  }
  // FREE_ABOVE
  const threshold = rule.free_above_threshold ?? 0;
  if (subtotal >= threshold) {
    return { shipping: 0, freeShippingShortfall: null };
  }
  return { shipping: rule.flat_fee, freeShippingShortfall: threshold - subtotal };
}

/**
 * Commission is charged on the PRODUCT subtotal by default — not on shipping,
 * which is the seller's cost to recover. A rule may opt into ORDER_TOTAL or
 * SHIPPING instead.
 */
export function computeCommission(
  rule: CommissionRule | null,
  amounts: { subtotal: number; shipping: number; discount: number }
): number {
  if (!rule) return 0;

  const base =
    rule.applies_to === "ORDER_TOTAL"
      ? amounts.subtotal - amounts.discount + amounts.shipping
      : rule.applies_to === "SHIPPING"
        ? amounts.shipping
        : amounts.subtotal - amounts.discount;

  if (base <= 0) return rule.fixed_amount;
  return percentOf(base, rule.percentage) + rule.fixed_amount;
}

/**
 * Builds the full quote from server-side lines. The parent order fans out into
 * one seller_order per seller — which is also why the customer sees "arrives
 * in N packages".
 */
export function buildQuote(
  lines: QuoteLine[],
  context: {
    stores: Map<string, { name: string; slug: string }>;
    shippingRules: Map<string, ShippingRule>;
    commissionRules: CommissionRule[];
  }
): Quote {
  const bySeller = new Map<string, QuoteLine[]>();
  for (const line of lines) {
    const existing = bySeller.get(line.sellerId);
    if (existing) existing.push(line);
    else bySeller.set(line.sellerId, [line]);
  }

  const sellers: SellerQuote[] = [];

  for (const [sellerId, sellerLines] of bySeller) {
    const priced = sellerLines.map((l) => ({ ...l, lineTotal: l.unitPrice * l.qty }));
    const subtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0);

    // Coupons land in P4; the field exists so the maths and the ledger already
    // account for a discount rather than being retrofitted later.
    const discount = 0;

    const rule = context.shippingRules.get(sellerId);
    const { shipping, freeShippingShortfall } = computeShipping(rule, subtotal - discount);

    // Commission is resolved per seller using the first line's category as the
    // scope hint; a category-specific rule only applies when every line in the
    // basket shares that category.
    const categoryIds = new Set(priced.map((l) => l.categoryId));
    const scopeCategory = categoryIds.size === 1 ? (priced[0].categoryId ?? null) : null;
    const commissionRule = selectCommissionRule(context.commissionRules, {
      sellerId,
      categoryId: scopeCategory,
    });
    const commission = computeCommission(commissionRule, { subtotal, shipping, discount });

    const tax = 0; // GST handling is a later phase; kept explicit, not hidden.
    const store = context.stores.get(priced[0].storeId);

    sellers.push({
      sellerId,
      storeId: priced[0].storeId,
      storeName: store?.name ?? "Store",
      storeSlug: store?.slug ?? "",
      lines: priced,
      subtotal,
      discount,
      shipping,
      tax,
      commission,
      sellerPayable: subtotal - discount + shipping - commission,
      dispatchSlaHours: rule?.dispatch_sla_hours ?? 48,
      freeShippingShortfall,
    });
  }

  // Stable order so the quote, the UI and the created rows all agree.
  sellers.sort((a, b) => a.storeName.localeCompare(b.storeName));

  const sum = (pick: (s: SellerQuote) => number) => sellers.reduce((t, s) => t + pick(s), 0);
  const subtotal = sum((s) => s.subtotal);
  const discountTotal = sum((s) => s.discount);
  const shippingTotal = sum((s) => s.shipping);
  const taxTotal = sum((s) => s.tax);

  return {
    sellers,
    subtotal,
    discountTotal,
    shippingTotal,
    taxTotal,
    commissionTotal: sum((s) => s.commission),
    grandTotal: subtotal - discountTotal + shippingTotal + taxTotal,
    shipmentCount: sellers.length,
  };
}

/**
 * Invariant check before money moves. The sum of what sellers receive plus
 * what Sakdha keeps must equal exactly what the customer is charged — if this
 * ever fails, the split is wrong and the order must not be created.
 */
export function assertQuoteBalances(quote: Quote): void {
  const payableTotal = quote.sellers.reduce((t, s) => t + s.sellerPayable, 0);
  const expected = quote.grandTotal - quote.taxTotal;
  if (payableTotal + quote.commissionTotal !== expected) {
    throw new Error(
      `Quote does not balance: sellers ${payableTotal} + commission ${quote.commissionTotal} !== ${expected}`
    );
  }
}
