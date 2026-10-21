"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlatformPeriod } from "@/lib/db/finance";
import { periodOf } from "@/lib/commerce/settlement";
import type { ActionResult } from "@/lib/actions/products";

/**
 * Settlement runs.
 *
 * With Razorpay Route enabled, each seller's share is transferred at payment
 * time and Razorpay settles it to their bank — these records then exist for
 * reconciliation. Without Route (or while running unsplit), Sakdha has
 * collected everything and these records are the actual statement of debt, so
 * they are generated the same way either way.
 *
 * Admin-only, service-role writes: `settlements` has a read policy for sellers
 * and no write policy at all, by design.
 */

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "admin") return null;
  return user;
}

/**
 * Computes every seller's position for a period and records it.
 *
 * Idempotent: re-running a period updates the existing rows (unique on
 * seller_id + period) rather than paying anyone twice. Rows already marked
 * `paid` are left alone — a completed payout is history, not a draft.
 */
export async function runSettlement(period: string): Promise<ActionResult<{ count: number; skipped: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Admins only." };

  if (!PERIOD.test(period)) {
    return { ok: false, error: "Period must look like 2026-10." };
  }
  // Settling a month before it ends would understate it and then need redoing.
  if (period >= periodOf(new Date())) {
    return { ok: false, error: "That period has not finished yet." };
  }

  const { settlements } = await getPlatformPeriod(period);
  if (settlements.length === 0) {
    return { ok: false, error: "No seller activity in that period." };
  }

  const { data: existingRows } = await supabaseAdmin
    .from("settlements")
    .select("seller_id, status")
    .eq("period", period);
  const alreadyPaid = new Set(
    ((existingRows ?? []) as { seller_id: string; status: string }[])
      .filter((r) => r.status === "paid")
      .map((r) => r.seller_id)
  );

  // Resolve each payee's store server-side. The settlement is store-scoped
  // accounting, but the seller remains the PAYEE and the Razorpay beneficiary
  // — both IDs are persisted, and neither is taken from client input.
  const payees = settlements.filter((s) => !alreadyPaid.has(s.sellerId));
  const storeBySeller = new Map<string, string>();
  if (payees.length > 0) {
    const { data: storeRows } = await supabaseAdmin
      .from("stores")
      .select("id, seller_id")
      .in("seller_id", payees.map((s) => s.sellerId));
    for (const row of (storeRows ?? []) as { id: string; seller_id: string }[]) {
      storeBySeller.set(row.seller_id, row.id);
    }
  }

  // A payee with no resolvable store would produce an unattributable payout.
  // Refuse the whole run rather than record a partially-scoped period.
  const unresolved = payees.filter((s) => !storeBySeller.has(s.sellerId));
  if (unresolved.length > 0) {
    return {
      ok: false,
      error: `${unresolved.length} seller(s) in this period have no store; settlement cannot be attributed.`,
    };
  }

  const rows = payees.map((s) => ({
    seller_id: s.sellerId,
    store_id: storeBySeller.get(s.sellerId)!,
    period,
    gross: s.gross,
    commission: s.commission,
    refunds: s.refunds,
    net_payable: s.netPayable,
    status: "pending",
  }));

  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("settlements")
      .upsert(rows, { onConflict: "seller_id,period" });
    if (error) return { ok: false, error: `Could not record settlements: ${error.message}` };
  }

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: admin.id,
    action: "settlement.run",
    entity: "settlements",
    entity_id: period,
    diff_json: { settled: rows.length, skippedAlreadyPaid: alreadyPaid.size },
  });

  revalidatePath("/admin/finance");
  revalidatePath("/seller/finance");
  return { ok: true, count: rows.length, skipped: alreadyPaid.size };
}

const PaidSchema = z.object({
  settlementId: z.string().uuid(),
  reference: z.string().max(120).optional().or(z.literal("")),
});

/**
 * Marks a settlement paid out. This records that money left Sakdha — it does
 * not move it. The transfer happens in Razorpay or the bank; this is the
 * bookkeeping entry, which is why it is admin-only and audited.
 */
export async function markSettlementPaid(
  input: z.input<typeof PaidSchema>
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Admins only." };

  const parsed = PaidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid settlement." };

  const { data: settlement } = await supabaseAdmin
    .from("settlements")
    .select("id, seller_id, store_id, period, net_payable, status")
    .eq("id", parsed.data.settlementId)
    .maybeSingle();
  if (!settlement) return { ok: false, error: "Settlement not found." };

  const row = settlement as {
    id: string;
    seller_id: string;
    store_id: string | null;
    period: string;
    net_payable: number;
    status: string;
  };
  if (row.status === "paid") return { ok: false, error: "That settlement is already paid." };

  const { error } = await supabaseAdmin
    .from("settlements")
    .update({
      status: "paid",
      razorpay_settlement_id: parsed.data.reference || null,
    })
    .eq("id", row.id)
    .eq("status", "pending"); // guard against two admins paying at once
  if (error) return { ok: false, error: "Could not mark it paid." };

  // The payout is itself a movement of money and belongs in the ledger.
  // Carries the settlement's own store_id rather than re-resolving it, so the
  // payout row and the settlement it records can never disagree. Falls back to
  // a server-side lookup for settlements created before 0013 added the column.
  const payoutStoreId =
    row.store_id ??
    ((
      await supabaseAdmin
        .from("stores")
        .select("id")
        .eq("seller_id", row.seller_id)
        .maybeSingle()
    ).data as { id: string } | null)?.id ??
    null;

  const { error: ledgerError } = await supabaseAdmin.from("ledger_entries").insert({
    order_id: null,
    seller_order_id: null,
    seller_id: row.seller_id,
    store_id: payoutStoreId,
    type: "SETTLEMENT",
    amount: row.net_payable,
    direction: "debit",
    ref_json: { settlement_id: row.id, period: row.period, reference: parsed.data.reference || null },
  });
  if (ledgerError) {
    return { ok: false, error: `Marked paid, but the ledger entry failed: ${ledgerError.message}` };
  }

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: admin.id,
    action: "settlement.paid",
    entity: "settlements",
    entity_id: row.id,
    diff_json: { period: row.period, amount: row.net_payable },
  });

  revalidatePath("/admin/finance");
  revalidatePath("/seller/finance");
  return { ok: true };
}
