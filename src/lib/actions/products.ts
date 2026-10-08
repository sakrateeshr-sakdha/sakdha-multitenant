"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUnsplitCheckoutAllowed } from "@/lib/payments/razorpay";

/**
 * Seller catalogue management.
 *
 * Authorization is RLS, not hand-written checks: these writes go through the
 * user-scoped client, and `products_member_write` already restricts rows to the
 * caller's seller. A forged product id simply matches no row. The service-role
 * client appears only where RLS deliberately has no policy (slug redirects,
 * storage uploads, the denormalised product counter).
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ProductSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(3).max(120).regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens"),
  shortDescription: z.string().max(300).optional().or(z.literal("")),
  description: z.string().max(5000).optional().or(z.literal("")),
  categoryId: z.string().uuid().nullable(),
  /** Paise. The form collects rupees and converts before calling. */
  price: z.number().int().min(0).max(100_000_000),
  compareAtPrice: z.number().int().min(0).max(100_000_000).nullable(),
  gender: z.string().max(40).optional().or(z.literal("")),
  fabric: z.string().max(60).optional().or(z.literal("")),
  pattern: z.string().max(60).optional().or(z.literal("")),
  fit: z.string().max(60).optional().or(z.literal("")),
  occasion: z.string().max(60).optional().or(z.literal("")),
  washCare: z.string().max(200).optional().or(z.literal("")),
  weightGrams: z.number().int().min(0).max(100000).nullable(),
  seoTitle: z.string().max(160).optional().or(z.literal("")),
  seoDescription: z.string().max(320).optional().or(z.literal("")),
});

const VariantSchema = z.object({
  id: z.string().uuid().optional(),
  value: z.string().min(1).max(40),
  sku: z.string().max(60).optional().or(z.literal("")),
  priceOverride: z.number().int().min(0).max(100_000_000).nullable(),
  inventoryQty: z.number().int().min(0).max(100000),
  isActive: z.boolean(),
});

export type ProductInput = z.input<typeof ProductSchema>;
export type VariantInput = z.input<typeof VariantSchema>;

export type ActionFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
};

/** `ActionResult` for a bare success; `ActionResult<{id: string}>` to return data. */
export type ActionResult<T = object> = ({ ok: true } & T) | ActionFailure;

/** The caller's seller + store, or null if they are not a seller. */
async function currentSeller() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: seller } = await supabase
    .from("sellers")
    .select("id, status, razorpay_account_id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (!seller) return null;

  const row = seller as { id: string; status: string; razorpay_account_id: string | null };
  const { data: store } = await supabase
    .from("stores")
    .select("id, slug")
    .eq("seller_id", row.id)
    .maybeSingle();

  return { supabase, user, seller: row, store: store as { id: string; slug: string } | null };
}

/**
 * A product may only go ACTIVE when its seller could actually be paid for it.
 * This mirrors the rule checkout enforces, so "publishable" and "buyable" never
 * diverge — a listed product that checkout refuses is worse than an unlisted one.
 */
function publishBlockedReason(seller: {
  status: string;
  razorpay_account_id: string | null;
}): string | null {
  if (seller.status !== "ACTIVE") {
    return "Your seller account is not approved yet, so products cannot go live.";
  }
  if (!seller.razorpay_account_id && !isUnsplitCheckoutAllowed()) {
    return "Connect your payout account before publishing — checkout would refuse these orders.";
  }
  return null;
}

/** ACTIVE products only: the storefront and sitemaps gate on this counter. */
async function syncProductCount(storeId: string) {
  const { count } = await supabaseAdmin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("status", "ACTIVE");
  await supabaseAdmin.from("stores").update({ product_count: count ?? 0 }).eq("id", storeId);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createProduct(
  input: ProductInput
): Promise<ActionResult<{ productId: string }>> {
  const context = await currentSeller();
  if (!context?.store) {
    return { ok: false, error: "You need a seller account and a store first." };
  }

  const parsed = ProductSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  if (data.compareAtPrice != null && data.compareAtPrice <= data.price) {
    return {
      ok: false,
      error: "The compare-at price must be higher than the price.",
      fieldErrors: { compareAtPrice: ["Must be higher than the selling price."] },
    };
  }

  // Slugs are global: another seller may already hold this one.
  const { data: taken } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("slug", data.slug)
    .maybeSingle();
  if (taken) {
    return {
      ok: false,
      error: "That product address is taken.",
      fieldErrors: { slug: ["This address is already in use."] },
    };
  }

  const { data: created, error } = await context.supabase
    .from("products")
    .insert({
      store_id: context.store.id,
      seller_id: context.seller.id,
      slug: data.slug,
      name: data.name,
      short_description: data.shortDescription || null,
      description: data.description || null,
      category_id: data.categoryId,
      price: data.price,
      compare_at_price: data.compareAtPrice,
      gender: data.gender || null,
      fabric: data.fabric || null,
      pattern: data.pattern || null,
      fit: data.fit || null,
      occasion: data.occasion || null,
      wash_care: data.washCare || null,
      weight_grams: data.weightGrams,
      seo_title: data.seoTitle || null,
      seo_description: data.seoDescription || null,
      status: "DRAFT", // always starts as a draft; publishing is a separate act
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: "Could not create the product." };
  }

  revalidatePath("/seller/products");
  return { ok: true, productId: (created as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateProduct(
  productId: string,
  input: ProductInput
): Promise<ActionResult> {
  const context = await currentSeller();
  if (!context) return { ok: false, error: "Not signed in as a seller." };

  const parsed = ProductSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  if (data.compareAtPrice != null && data.compareAtPrice <= data.price) {
    return {
      ok: false,
      error: "The compare-at price must be higher than the price.",
      fieldErrors: { compareAtPrice: ["Must be higher than the selling price."] },
    };
  }

  // RLS already scopes this read to the caller's own products.
  const { data: existing } = await context.supabase
    .from("products")
    .select("id, slug, status, store_id")
    .eq("id", productId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Product not found." };
  const current = existing as { slug: string; status: string; store_id: string };

  if (data.slug !== current.slug) {
    const { data: taken } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("slug", data.slug)
      .neq("id", productId)
      .maybeSingle();
    if (taken) {
      return {
        ok: false,
        error: "That product address is taken.",
        fieldErrors: { slug: ["This address is already in use."] },
      };
    }
  }

  const { error } = await context.supabase
    .from("products")
    .update({
      slug: data.slug,
      name: data.name,
      short_description: data.shortDescription || null,
      description: data.description || null,
      category_id: data.categoryId,
      price: data.price,
      compare_at_price: data.compareAtPrice,
      gender: data.gender || null,
      fabric: data.fabric || null,
      pattern: data.pattern || null,
      fit: data.fit || null,
      occasion: data.occasion || null,
      wash_care: data.washCare || null,
      weight_grams: data.weightGrams,
      seo_title: data.seoTitle || null,
      seo_description: data.seoDescription || null,
    })
    .eq("id", productId);

  if (error) return { ok: false, error: "Could not save the product." };

  // Preserve the old URL. The PDP looks this up and permanently redirects, so an
  // indexed or shared link never dead-ends after a rename.
  if (data.slug !== current.slug) {
    await supabaseAdmin
      .from("product_slug_redirects")
      .upsert({ old_slug: current.slug, product_id: productId }, { onConflict: "old_slug" });
    // If this slug was previously redirected elsewhere, that entry is now a loop.
    await supabaseAdmin.from("product_slug_redirects").delete().eq("old_slug", data.slug);
    revalidatePath(`/product/${current.slug}`);
  }

  revalidatePath("/seller/products");
  revalidatePath(`/product/${data.slug}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publish / unpublish / archive
// ---------------------------------------------------------------------------

export async function setProductStatus(
  productId: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED"
): Promise<ActionResult> {
  const context = await currentSeller();
  if (!context?.store) return { ok: false, error: "Not signed in as a seller." };

  if (status === "ACTIVE") {
    const blocked = publishBlockedReason(context.seller);
    if (blocked) return { ok: false, error: blocked };

    // A product with no price or no image is not ready to be sold.
    const { data: product } = await context.supabase
      .from("products")
      .select("price, product_media(id)")
      .eq("id", productId)
      .maybeSingle();
    const row = product as { price: number; product_media: { id: string }[] } | null;
    if (!row) return { ok: false, error: "Product not found." };
    if (row.price <= 0) return { ok: false, error: "Set a price before publishing." };
    if ((row.product_media ?? []).length === 0) {
      return { ok: false, error: "Add at least one photo before publishing." };
    }
  }

  const { error } = await context.supabase
    .from("products")
    .update({ status })
    .eq("id", productId);
  if (error) return { ok: false, error: "Could not change the product status." };

  await syncProductCount(context.store.id);
  revalidatePath("/seller/products");
  revalidatePath(`/store/${context.store.slug}`);
  return { ok: true };
}

/**
 * Archive rather than delete when a product has ever been ordered: order_items
 * reference it, and the customer's order history must stay readable.
 */
export async function deleteProduct(productId: string): Promise<ActionResult> {
  const context = await currentSeller();
  if (!context?.store) return { ok: false, error: "Not signed in as a seller." };

  const { count } = await supabaseAdmin
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if ((count ?? 0) > 0) {
    const { error } = await context.supabase
      .from("products")
      .update({ status: "ARCHIVED" })
      .eq("id", productId);
    if (error) return { ok: false, error: "Could not archive the product." };
    await syncProductCount(context.store.id);
    revalidatePath("/seller/products");
    return { ok: true };
  }

  const { error } = await context.supabase.from("products").delete().eq("id", productId);
  if (error) return { ok: false, error: "Could not delete the product." };

  await syncProductCount(context.store.id);
  revalidatePath("/seller/products");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/**
 * Replaces the product's size variants with the supplied set.
 *
 * Variants that already exist are updated in place rather than recreated —
 * their ids appear in cart_items and order_items, and reserved_qty may be
 * holding stock for an in-flight checkout. Removed variants are deactivated,
 * never deleted, for the same reason.
 */
export async function saveVariants(
  productId: string,
  variants: VariantInput[]
): Promise<ActionResult> {
  const context = await currentSeller();
  if (!context) return { ok: false, error: "Not signed in as a seller." };

  const parsed = z.array(VariantSchema).max(50).safeParse(variants);
  if (!parsed.success) return { ok: false, error: "Check the variant rows." };
  const rows = parsed.data;

  const values = rows.map((v) => v.value.trim().toUpperCase());
  if (new Set(values).size !== values.length) {
    return { ok: false, error: "Each size may only appear once." };
  }

  const { data: owned } = await context.supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (!owned) return { ok: false, error: "Product not found." };

  // "Size" is the only option dimension today; create it on first use.
  if (rows.length > 0) {
    const { data: option } = await context.supabase
      .from("product_options")
      .select("id")
      .eq("product_id", productId)
      .eq("name", "Size")
      .maybeSingle();
    if (!option) {
      await context.supabase
        .from("product_options")
        .insert({ product_id: productId, name: "Size", position: 0 });
    }
  }

  const { data: existingRows } = await context.supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);
  const existingIds = new Set(((existingRows ?? []) as { id: string }[]).map((v) => v.id));

  for (const variant of rows) {
    const payload = {
      sku: variant.sku || null,
      option_values_json: { Size: variant.value.trim().toUpperCase() },
      price_override: variant.priceOverride,
      inventory_qty: variant.inventoryQty,
      is_active: variant.isActive,
    };

    if (variant.id && existingIds.has(variant.id)) {
      const { error } = await context.supabase
        .from("product_variants")
        .update(payload)
        .eq("id", variant.id);
      if (error) return { ok: false, error: "Could not update a variant." };
      existingIds.delete(variant.id);
    } else {
      const { error } = await context.supabase
        .from("product_variants")
        .insert({ product_id: productId, ...payload });
      if (error) return { ok: false, error: "Could not add a variant." };
    }
  }

  // Whatever the seller removed: deactivate, keeping referential history intact.
  for (const staleId of existingIds) {
    await context.supabase
      .from("product_variants")
      .update({ is_active: false })
      .eq("id", staleId);
  }

  revalidatePath("/seller/products");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * Uploads a product image.
 *
 * The file goes to Storage with the service-role client, but only after the
 * user-scoped client has confirmed the product is theirs — so ownership is
 * still decided by RLS, not by trusting the submitted product id.
 */
export async function uploadProductImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const context = await currentSeller();
  if (!context?.store) return { ok: false, error: "Not signed in as a seller." };

  const productId = String(formData.get("productId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: "Use a JPEG, PNG, WebP or AVIF image." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Images must be 5MB or smaller." };
  }

  const { data: product } = await context.supabase
    .from("products")
    .select("id, slug, product_media(id)")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return { ok: false, error: "Product not found." };
  const row = product as { slug: string; product_media: { id: string }[] };
  if ((row.product_media ?? []).length >= 8) {
    return { ok: false, error: "A product can have at most 8 photos." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  // Suffix keeps re-uploads of the same filename from overwriting each other.
  const path = `${context.store.slug}/${row.slug}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("product-media")
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: "Upload failed. Please try again." };

  const url = supabaseAdmin.storage.from("product-media").getPublicUrl(path).data.publicUrl;

  const { error } = await context.supabase.from("product_media").insert({
    product_id: productId,
    url,
    type: "image",
    position: (row.product_media ?? []).length,
  });
  if (error) {
    // Do not leave an orphaned object paid for in storage.
    await supabaseAdmin.storage.from("product-media").remove([path]);
    return { ok: false, error: "Could not attach the image." };
  }

  revalidatePath(`/seller/products/${productId}`);
  return { ok: true, url };
}

export async function deleteProductImage(mediaId: string): Promise<ActionResult> {
  const context = await currentSeller();
  if (!context) return { ok: false, error: "Not signed in as a seller." };

  // RLS on product_media requires the parent product to belong to this seller.
  const { data: media } = await context.supabase
    .from("product_media")
    .select("id, url, product_id")
    .eq("id", mediaId)
    .maybeSingle();
  if (!media) return { ok: false, error: "Image not found." };
  const row = media as { url: string; product_id: string };

  const { error } = await context.supabase.from("product_media").delete().eq("id", mediaId);
  if (error) return { ok: false, error: "Could not remove the image." };

  // Best-effort storage cleanup; the row is already gone either way.
  const marker = "/product-media/";
  const index = row.url.indexOf(marker);
  if (index !== -1) {
    const path = decodeURIComponent(row.url.slice(index + marker.length));
    await supabaseAdmin.storage.from("product-media").remove([path]);
  }

  revalidatePath(`/seller/products/${row.product_id}`);
  return { ok: true };
}
