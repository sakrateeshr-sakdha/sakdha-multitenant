import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  periodBounds,
  settleSeller,
  settlePeriod,
  platformPosition,
  type LedgerRow,
  type SellerSettlement,
} from "@/lib/commerce/settlement";

const LEDGER_COLUMNS = "type, amount, direction, seller_id, order_id, created_at";

export type SettlementRecord = {
  id: string;
  period: string;
  gross: number;
  commission: number;
  refunds: number;
  net_payable: number;
  status: string;
  razorpay_settlement_id: string | null;
  created_at: string;
};

/**
 * A seller's own earnings for a period, computed live from the ledger.
 *
 * Deliberately not read from the settlements table: a seller should see what
 * they have earned *so far this month* before any settlement run exists.
 * Reads run under RLS — `ledger_seller_read` scopes rows to their own seller.
 */
export async function getSellerEarnings(period: string): Promise<SellerSettlement | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (!seller) return null;

  const sellerId = (seller as { id: string }).id;
  const { from, to } = periodBounds(period);

  const { data, error } = await supabase
    .from("ledger_entries")
    .select(LEDGER_COLUMNS)
    .eq("seller_id", sellerId)
    .gte("created_at", from)
    .lt("created_at", to);
  if (error) throw new Error(`getSellerEarnings: ${error.message}`);

  return settleSeller(sellerId, period, (data ?? []) as LedgerRow[]);
}

/** Settlement rows already generated for the caller's seller. */
export async function getSellerSettlements(): Promise<SettlementRecord[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("settlements")
    .select("id, period, gross, commission, refunds, net_payable, status, razorpay_settlement_id, created_at")
    .order("period", { ascending: false });
  if (error) throw new Error(`getSellerSettlements: ${error.message}`);
  return (data ?? []) as SettlementRecord[];
}

/** Per-order earnings for the seller's statement view. */
export async function getSellerOrderEarnings(period: string) {
  const supabase = await createServerSupabase();
  const { from, to } = periodBounds(period);

  const { data, error } = await supabase
    .from("seller_orders")
    .select(
      "id, status, subtotal, shipping, commission, seller_payable, created_at, orders:order_id(order_number, payment_status)"
    )
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getSellerOrderEarnings: ${error.message}`);

  // Only paid orders have moved money; unpaid ones would overstate earnings.
  return ((data ?? []) as unknown as {
    id: string;
    status: string;
    subtotal: number;
    shipping: number;
    commission: number;
    seller_payable: number;
    created_at: string;
    orders: { order_number: string; payment_status: string } | null;
  }[]).filter((o) => o.orders?.payment_status === "PAID");
}

// ---------------------------------------------------------------------------
// Admin / platform
// ---------------------------------------------------------------------------

/**
 * The whole platform's position for a period. Service role: this intentionally
 * crosses every seller, which no RLS policy allows — the caller must already
 * have established that the user is an admin.
 */
export async function getPlatformPeriod(period: string) {
  const { from, to } = periodBounds(period);

  const { data, error } = await supabaseAdmin
    .from("ledger_entries")
    .select(LEDGER_COLUMNS)
    .gte("created_at", from)
    .lt("created_at", to);
  if (error) throw new Error(`getPlatformPeriod: ${error.message}`);

  const rows = (data ?? []) as LedgerRow[];
  const settlements = settlePeriod(period, rows);

  // Attach names so the admin view is readable.
  const sellerIds = settlements.map((s) => s.sellerId);
  const names = new Map<string, string>();
  if (sellerIds.length > 0) {
    const { data: sellers } = await supabaseAdmin
      .from("sellers")
      .select("id, display_name, legal_name")
      .in("id", sellerIds);
    for (const s of ((sellers ?? []) as { id: string; display_name: string | null; legal_name: string }[])) {
      names.set(s.id, s.display_name || s.legal_name);
    }
  }

  return {
    settlements: settlements.map((s) => ({ ...s, sellerName: names.get(s.sellerId) ?? "Unknown seller" })),
    position: platformPosition(rows, settlements),
  };
}

/** Settlement rows already recorded for a period, keyed by seller. */
export async function getRecordedSettlements(period: string) {
  const { data } = await supabaseAdmin
    .from("settlements")
    .select("id, seller_id, net_payable, status, created_at")
    .eq("period", period);
  return new Map(
    ((data ?? []) as { id: string; seller_id: string; net_payable: number; status: string }[]).map(
      (s) => [s.seller_id, s]
    )
  );
}
