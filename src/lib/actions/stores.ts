"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** The tenant lifecycle from migration 0012. */
export type StoreStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";

/**
 * Moves a store through its lifecycle.
 *
 * `stores.status` is what the `stores_public_read` policy gates on, so this is
 * the switch that makes a storefront visible or dark — and because
 * `products_public_read` also requires the parent store to be ACTIVE, it takes
 * the store's whole catalogue with it. That is a bigger lever than it looks,
 * which is why every transition is written to `audit_logs`.
 *
 * Runs through `supabaseAdmin`: the caller is an admin, not a member of the
 * store, so the member-scoped write policy would otherwise reject them.
 */
export async function setStoreStatus(
  storeId: string,
  status: StoreStatus
): Promise<{ ok: boolean; error?: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: store } = await supabaseAdmin
    .from("stores")
    .select("id, slug, status, published_at, product_count")
    .eq("id", storeId)
    .maybeSingle();

  const current = store as {
    id: string;
    slug: string;
    status: StoreStatus;
    published_at: string | null;
    product_count: number;
  } | null;

  if (!current) return { ok: false, error: "Store not found." };
  if (current.status === status) {
    return { ok: false, error: `This store is already ${status.toLowerCase()}.` };
  }
  // CLOSED is the one transition a store should not be talked out of by a
  // stray click, so it is refused here and confirmed in the UI instead.
  if (current.status === "CLOSED" && status !== "DRAFT") {
    return { ok: false, error: "A closed store can only be reopened as a draft." };
  }

  const patch: Record<string, unknown> = { status };

  // First publish stamps the date; re-activating after a suspension keeps the
  // original, because the store was already once public.
  if (status === "ACTIVE" && !current.published_at) {
    patch.published_at = new Date().toISOString();
  }

  // A store that is not publicly readable must not sit in the sitemap either.
  // Activation deliberately does NOT set this true: indexability is earned via
  // seller approval (see setSellerStatus), and forcing it here would index a
  // store whose seller is still unverified.
  if (status !== "ACTIVE") patch.is_indexable = false;

  const { error } = await supabaseAdmin.from("stores").update(patch).eq("id", storeId);
  if (error) return { ok: false, error: "Could not update the store." };

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: auth.userId,
    action: `store.${status.toLowerCase()}`,
    entity: "stores",
    entity_id: storeId,
  });

  revalidatePath("/admin/stores");
  revalidatePath("/admin");
  // The storefront's own visibility just changed, as did the directory it
  // appears in.
  revalidatePath(`/store/${current.slug}`);
  revalidatePath("/stores");

  return { ok: true };
}
