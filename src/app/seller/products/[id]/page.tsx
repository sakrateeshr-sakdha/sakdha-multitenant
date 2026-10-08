import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { ProductForm, type ProductFormValues } from "@/components/seller/ProductForm";
import { MediaManager } from "@/components/seller/MediaManager";
import { VariantEditor, type VariantRow } from "@/components/seller/VariantEditor";
import { ProductStatusBar } from "@/components/seller/ProductStatusBar";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCategoryOptions } from "@/lib/db/seller";

export const metadata: Metadata = {
  title: "Edit product",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const STATUS_TONE = {
  ACTIVE: "success",
  DRAFT: "neutral",
  SUSPENDED: "danger",
  ARCHIVED: "neutral",
} as const;

/** Paise -> a plain rupee string for a number input (no separators). */
const rupees = (paise: number | null) => (paise == null ? "" : String(paise / 100));

export default async function EditProductPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS restricts this to the caller's own products — someone else's id 404s.
  const { data } = await supabase
    .from("products")
    .select(
      `id, slug, name, short_description, description, category_id, price, compare_at_price,
       gender, fabric, pattern, fit, occasion, wash_care, weight_grams,
       seo_title, seo_description, status,
       product_media ( id, url, position ),
       product_variants ( id, sku, option_values_json, price_override, inventory_qty, reserved_qty, is_active )`
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const product = data as unknown as {
    id: string;
    slug: string;
    name: string;
    short_description: string | null;
    description: string | null;
    category_id: string | null;
    price: number;
    compare_at_price: number | null;
    gender: string | null;
    fabric: string | null;
    pattern: string | null;
    fit: string | null;
    occasion: string | null;
    wash_care: string | null;
    weight_grams: number | null;
    seo_title: string | null;
    seo_description: string | null;
    status: keyof typeof STATUS_TONE;
    product_media: { id: string; url: string; position: number }[];
    product_variants: {
      id: string;
      sku: string | null;
      option_values_json: Record<string, string>;
      price_override: number | null;
      inventory_qty: number;
      reserved_qty: number;
      is_active: boolean;
    }[];
  };

  const [categories, orderCount] = await Promise.all([
    getCategoryOptions(),
    supabaseAdmin
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", id)
      .then((r) => r.count ?? 0),
  ]);

  const initial: ProductFormValues = {
    name: product.name,
    slug: product.slug,
    shortDescription: product.short_description ?? "",
    description: product.description ?? "",
    categoryId: product.category_id ?? "",
    price: rupees(product.price),
    compareAtPrice: rupees(product.compare_at_price),
    gender: product.gender ?? "",
    fabric: product.fabric ?? "",
    pattern: product.pattern ?? "",
    fit: product.fit ?? "",
    occasion: product.occasion ?? "",
    washCare: product.wash_care ?? "",
    weightGrams: product.weight_grams == null ? "" : String(product.weight_grams),
    seoTitle: product.seo_title ?? "",
    seoDescription: product.seo_description ?? "",
  };

  const variantRows: VariantRow[] = product.product_variants
    .filter((v) => v.is_active)
    .map((v) => ({
      id: v.id,
      value: v.option_values_json?.Size ?? "",
      sku: v.sku ?? "",
      priceOverride: rupees(v.price_override),
      inventoryQty: String(v.inventory_qty),
      isActive: v.is_active,
      reservedQty: v.reserved_qty,
    }));

  return (
    <>
      <SiteHeader />
      <main className="container-content max-w-3xl pb-20 pt-8">
        <Link
          href="/seller/products"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-brand-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Products
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl font-semibold text-ink-900">{product.name}</h1>
              <Badge tone={STATUS_TONE[product.status] ?? "neutral"}>
                {product.status.toLowerCase()}
              </Badge>
            </div>
            {product.status === "ACTIVE" && (
              <Link
                href={`/product/${product.slug}`}
                className="mt-1 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
              >
                View live page
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          <ProductStatusBar
            productId={product.id}
            status={product.status}
            hasBeenOrdered={orderCount > 0}
          />
        </div>

        {product.status === "DRAFT" && (
          <p className="mt-4 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-ink-600">
            This is a draft — it isn&apos;t visible to shoppers. Publishing needs a price and
            at least one photo.
          </p>
        )}

        <div className="mt-8 space-y-8">
          <section className="rounded-2xl border border-line bg-surface p-6 md:p-8">
            <MediaManager productId={product.id} media={product.product_media} />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-6 md:p-8">
            <VariantEditor productId={product.id} initial={variantRows} />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-6 md:p-8">
            <ProductForm categories={categories} productId={product.id} initial={initial} />
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
