"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt, isEncryptionConfigured } from "@/lib/crypto";

/**
 * Payout-account changes (spec: migration 0016).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: activate an account.
 *
 * A request lands as `pending` and stops there. Nothing in this file writes to
 * `seller_bank_accounts`, touches `sellers.razorpay_account_id`, or marks a
 * request `active`, because this deployment cannot verify a new account with
 * the provider:
 *
 *   • Razorpay Route is not enabled on the merchant account, so every seller
 *     has `razorpay_account_id = NULL` and `razorpay_product_config = NULL`.
 *   • `updateSettlementAccount(accountId, productId, …)` requires both. With
 *     neither, there is no supported call to make.
 *   • Razorpay publishes no webhook for settlement-account activation, so even
 *     with Route enabled, `verifying -> active` cannot be driven by an event.
 *
 * Marking a request active without provider confirmation would tell a store
 * their money is going somewhere it is not. The request half is genuinely
 * useful on its own — it is authorised, validated, encrypted and audited — so
 * it ships, and activation waits for a capability that actually exists.
 *
 * See STORE_SCOPED_FINANCE_RUNBOOK.md for the activation design that becomes
 * possible once Route is live.
 */

const RequestSchema = z.object({
  storeId: z.string().uuid(),
  accountName: z.string().min(2).max(120),
  // Matches the onboarding rule in seller.ts rather than inventing a new one.
  accountNumber: z.string().regex(/^\d{6,20}$/, "Enter a valid account number"),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC"),
});

export type PayoutRequestInput = z.input<typeof RequestSchema>;

export type PayoutRequestResult =
  | { ok: true; requestId: string; pendingVerification: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Raises a payout-account change request for a store.
 *
 * Authorisation is server-side and store-scoped: being signed in, or even
 * being a member of the store, is not enough — `can_manage_store_payouts()`
 * requires ownership or an explicit grant. The storeId is validated against
 * that check rather than trusted, so naming someone else's store fails.
 */
export async function requestPayoutAccountChange(
  input: PayoutRequestInput
): Promise<PayoutRequestResult> {
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please check the account details.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // The authorisation boundary. Runs as the caller, so it answers for THIS
  // user and cannot be satisfied by passing a different store id.
  const { data: authorised, error: authError } = await supabase.rpc(
    "can_manage_store_payouts",
    { target_store: data.storeId }
  );
  if (authError) return { ok: false, error: "Could not verify your permissions." };
  if (authorised !== true) {
    // Same message whether the store does not exist or the caller simply may
    // not touch it — a permission probe should not map out other stores.
    return { ok: false, error: "You do not have permission to change payout details for this store." };
  }

  if (!isEncryptionConfigured()) {
    // Refusing beats storing an account number in the clear.
    return { ok: false, error: "Payout changes are unavailable: encryption is not configured." };
  }

  // Resolve the payee from the store, server-side. Never from the caller.
  const { data: storeRow } = await supabaseAdmin
    .from("stores")
    .select("id, seller_id, name")
    .eq("id", data.storeId)
    .maybeSingle();
  const store = storeRow as { id: string; seller_id: string; name: string } | null;
  if (!store) return { ok: false, error: "Store not found." };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("payout_change_requests")
    .insert({
      store_id: store.id,
      seller_id: store.seller_id,
      requested_by: user.id,
      account_name: data.accountName,
      account_number_enc: encrypt(data.accountNumber),
      ifsc: data.ifsc,
      account_last4: data.accountNumber.slice(-4),
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    // `payout_change_requests_one_open` (0016) permits a single open request
    // per store; two in flight would race to become the beneficiary.
    if (insertError.code === "23505") {
      return { ok: false, error: "A payout change is already awaiting review for this store." };
    }
    return { ok: false, error: "Could not record the payout change request." };
  }

  const requestId = (inserted as { id: string }).id;

  // Audit trail carries WHO and WHICH, never the account number. The last 4
  // digits are enough to tell two requests apart in a review.
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: user.id,
    action: "payout.change_requested",
    entity: "payout_change_requests",
    entity_id: requestId,
    diff_json: {
      store_id: store.id,
      ifsc: data.ifsc,
      account_last4: data.accountNumber.slice(-4),
    },
  });

  // Tell the store's owners, so a change raised by a granted finance member is
  // never invisible to the person who owns the business.
  const { data: owners } = await supabaseAdmin
    .from("store_members")
    .select("profile_id")
    .eq("store_id", store.id)
    .eq("role", "owner");

  const recipients = ((owners ?? []) as { profile_id: string }[])
    .map((o) => o.profile_id)
    .filter((id) => id !== user.id);

  if (recipients.length > 0) {
    await supabaseAdmin.from("notifications").insert(
      recipients.map((id) => ({
        recipient_id: id,
        audience: "seller",
        type: "payout.change_requested",
        payload_json: {
          store_id: store.id,
          store_name: store.name,
          account_last4: data.accountNumber.slice(-4),
          requested_by: user.id,
        },
      }))
    );
  }

  revalidatePath("/seller/finance");
  return { ok: true, requestId, pendingVerification: true };
}

/**
 * The open request for a store, for display.
 *
 * Returns `account_last4` and never `account_number_enc`: the ciphertext has
 * no business leaving the server, and nothing in the UI needs it.
 */
export async function getOpenPayoutRequest(storeId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("payout_change_requests")
    .select("id, status, account_name, account_last4, ifsc, created_at")
    .eq("store_id", storeId)
    .in("status", ["pending", "verifying"])
    .maybeSingle();
  return data as {
    id: string;
    status: string;
    account_name: string;
    account_last4: string | null;
    ifsc: string;
    created_at: string;
  } | null;
}
