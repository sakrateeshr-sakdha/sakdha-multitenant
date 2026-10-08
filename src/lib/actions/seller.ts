"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt, isEncryptionConfigured } from "@/lib/crypto";
import {
  createLinkedAccount,
  createStakeholder,
  isRazorpayConfigured,
  RazorpayApiError,
  requestRouteProduct,
  updateSettlementAccount,
} from "@/lib/payments/razorpay";

/**
 * Seller onboarding (spec §10).
 *
 * The state machine is deliberate: a seller reaches ACTIVE — and so becomes
 * able to receive orders — only after Sakdha has a Route linked account for
 * them AND an admin has approved. Checkout refuses any seller missing either,
 * because there would be nowhere to send their money.
 *
 *   DRAFT → PENDING_VERIFICATION → PENDING_APPROVAL → ACTIVE
 *                                              ↘ REJECTED / SUSPENDED
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const OnboardingSchema = z.object({
  legalName: z.string().min(2).max(160),
  displayName: z.string().min(2).max(80),
  businessType: z.enum([
    "individual",
    "proprietorship",
    "partnership",
    "private_limited",
    "public_limited",
    "llp",
    "not_yet_registered",
  ]),
  contactName: z.string().min(2).max(120),
  phone: z.string().min(8).max(20),
  pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN").optional().or(z.literal("")),
  gst: z.string().max(20).optional().or(z.literal("")),

  storeSlug: z
    .string()
    .min(3)
    .max(60)
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens only"),
  storeName: z.string().min(2).max(80),
  storeDescription: z.string().max(600).optional().or(z.literal("")),

  street1: z.string().min(1).max(200),
  street2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),

  bankAccountName: z.string().min(2).max(120),
  bankAccountNumber: z.string().regex(/^\d{6,20}$/, "Enter a valid account number"),
  bankIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC"),
});

export type OnboardingInput = z.input<typeof OnboardingSchema>;

export type OnboardingResult =
  | { ok: true; sellerId: string; storeSlug: string; linkedAccount: boolean; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function submitSellerOnboarding(
  input: OnboardingInput
): Promise<OnboardingResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to start selling." };
  }

  const parsed = OnboardingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  // Bank details are useless to us if we cannot store them safely.
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error:
        "Secure storage is not configured on this deployment (ENCRYPTION_KEY). Bank details cannot be accepted yet.",
    };
  }

  // One seller account per user.
  const { data: existing } = await supabaseAdmin
    .from("sellers")
    .select("id, status")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: "You already have a seller account. Continue from your seller dashboard.",
    };
  }

  // Store slugs are public URLs and must be unique.
  const { data: slugTaken } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("slug", data.storeSlug)
    .maybeSingle();
  if (slugTaken) {
    return {
      ok: false,
      error: "That store address is taken.",
      fieldErrors: { storeSlug: ["This store address is already in use."] },
    };
  }

  // 1. Seller record.
  const { data: sellerRow, error: sellerError } = await supabaseAdmin
    .from("sellers")
    .insert({
      owner_profile_id: user.id,
      legal_name: data.legalName,
      display_name: data.displayName,
      status: "PENDING_VERIFICATION",
      onboarding_step: "submitted",
      kyc_json: {
        business_type: data.businessType,
        contact_name: data.contactName,
        // Persist the phone here too. It is needed to create the Razorpay
        // linked account, and that call can fail (or be deferred until Route is
        // enabled) — without storing it, a retry would have to ask the seller
        // for it again and admin would have no way to contact them meanwhile.
        phone: data.phone,
        pan: data.pan || null,
        gst: data.gst || null,
        address: {
          street1: data.street1,
          street2: data.street2 || null,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
        },
      },
    })
    .select("id")
    .single();
  if (sellerError || !sellerRow) {
    return { ok: false, error: "Could not create your seller account." };
  }
  const sellerId = (sellerRow as { id: string }).id;

  // 2. Store. Not indexable until approved — an unapproved store must not
  //    reach Google.
  const { error: storeError } = await supabaseAdmin.from("stores").insert({
    seller_id: sellerId,
    slug: data.storeSlug,
    name: data.storeName,
    description: data.storeDescription || null,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
    is_indexable: false,
  });
  if (storeError) {
    await supabaseAdmin.from("sellers").delete().eq("id", sellerId);
    return { ok: false, error: "Could not create your store." };
  }

  // 3. Bank account — encrypted at rest, never logged.
  const { error: bankError } = await supabaseAdmin.from("seller_bank_accounts").insert({
    seller_id: sellerId,
    account_name: data.bankAccountName,
    account_number_enc: encrypt(data.bankAccountNumber),
    ifsc: data.bankIfsc,
    verified: false,
  });
  if (bankError) {
    return { ok: false, error: "Could not save your bank details." };
  }

  // 4. Default shipping rule so the seller's first order prices correctly even
  //    before they visit settings.
  await supabaseAdmin.from("shipping_rules").upsert(
    { seller_id: sellerId, type: "FREE_ABOVE", flat_fee: 9900, free_above_threshold: 149900, dispatch_sla_hours: 48 },
    { onConflict: "seller_id" }
  );

  // 5. Razorpay Route linked account. Without this the seller cannot be paid,
  //    so a failure here is reported but does NOT discard the application —
  //    an admin can retry it.
  let linkedAccount = false;
  let warning: string | undefined;

  if (!isRazorpayConfigured()) {
    warning =
      "Your application was saved, but payouts are not configured on this deployment yet.";
  } else {
    try {
      const account = await createLinkedAccount({
        email: user.email!,
        phone: data.phone,
        legalBusinessName: data.legalName,
        customerFacingName: data.storeName,
        contactName: data.contactName,
        businessType: data.businessType,
        address: {
          street1: data.street1,
          street2: data.street2 || undefined,
          city: data.city,
          state: data.state,
          postalCode: data.pincode,
        },
        referenceId: sellerId,
        pan: data.pan || undefined,
        gst: data.gst || undefined,
      });

      await createStakeholder(account.id, {
        name: data.contactName,
        email: user.email!,
        phone: data.phone,
        pan: data.pan || undefined,
      });

      const product = await requestRouteProduct(account.id);
      await updateSettlementAccount(account.id, product.id, {
        beneficiaryName: data.bankAccountName,
        accountNumber: data.bankAccountNumber,
        ifsc: data.bankIfsc,
      });

      await supabaseAdmin
        .from("sellers")
        .update({
          razorpay_account_id: account.id,
          razorpay_product_config: product.id,
          status: "PENDING_APPROVAL",
          onboarding_step: "awaiting_approval",
        })
        .eq("id", sellerId);

      linkedAccount = true;
    } catch (error) {
      const message =
        error instanceof RazorpayApiError ? error.message : "Payout setup could not be completed.";
      console.error("linked account creation failed:", error);
      warning = `${message} An admin will retry this before your store goes live.`;
    }
  }

  // 6. Promote the profile so the seller dashboard is reachable, and keep the
  //    phone on the profile — signup only collects name/email/password, so this
  //    is the first point at which we learn it. Checkout prefills from here.
  await supabaseAdmin
    .from("profiles")
    .update({ role: "seller", phone: data.phone })
    .eq("id", user.id);

  revalidatePath("/seller");
  return { ok: true, sellerId, storeSlug: data.storeSlug, linkedAccount, warning };
}

/**
 * Admin approval — the final gate before a seller can take money. Refuses
 * while there is no linked account, because an ACTIVE seller with nowhere to
 * settle would silently break checkout for every cart they appear in.
 */
export async function setSellerStatus(
  sellerId: string,
  status: "ACTIVE" | "REJECTED" | "SUSPENDED"
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return { ok: false, error: "Admins only." };
  }

  const { data: seller } = await supabaseAdmin
    .from("sellers")
    .select("id, razorpay_account_id")
    .eq("id", sellerId)
    .maybeSingle();
  if (!seller) return { ok: false, error: "Seller not found." };

  if (status === "ACTIVE" && !(seller as { razorpay_account_id: string | null }).razorpay_account_id) {
    return {
      ok: false,
      error: "This seller has no Razorpay linked account yet — they cannot be paid.",
    };
  }

  const { error } = await supabaseAdmin
    .from("sellers")
    .update({
      status,
      onboarding_step: status === "ACTIVE" ? "complete" : "review",
    })
    .eq("id", sellerId);
  if (error) return { ok: false, error: "Could not update the seller." };

  // An approved store may be indexed; a suspended one must not be.
  await supabaseAdmin
    .from("stores")
    .update({ is_indexable: status === "ACTIVE" })
    .eq("seller_id", sellerId);

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: user.id,
    action: `seller.${status.toLowerCase()}`,
    entity: "sellers",
    entity_id: sellerId,
  });

  revalidatePath("/admin/sellers");
  return { ok: true };
}
