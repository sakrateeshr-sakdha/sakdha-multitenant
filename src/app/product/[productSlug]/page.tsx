import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { MapPin, Package, RotateCcw, Store as StoreIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Breadcrumb, type Crumb } from "@/components/ui/Breadcrumb";
import { Badge } from "@/components/ui/Badge";
import { Rating } from "@/components/ui/Rating";
import { ProductGallery } from "@/components/marketplace/ProductGallery";
import { VariantPicker } from "@/components/marketplace/VariantPicker";
import { ProductGrid } from "@/components/marketplace/ProductGrid";
import { StructuredData } from "@/components/seo/StructuredData";
import {
  getApprovedReviews,
  getProductBySlug,
  getRedirectForSlug,
  getRelatedProducts,
  getStoreProducts,
  inStock,
} from "@/lib/db/catalog";
import { breadcrumbJsonLd, productJsonLd, productMetadata } from "@/lib/seo";

type Props = { params: Promise<{ productSlug: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productSlug } = await params;
  const product = await getProductBySlug(productSlug);
  if (!product) return { title: "Product not found" };
  return productMetadata(product);
}

const SPEC_FIELDS = [
  ["Fabric", "fabric"],
  ["Pattern", "pattern"],
  ["Fit", "fit"],
  ["Occasion", "occasion"],
  ["Gender", "gender"],
  ["Age group", "age_group"],
  ["Wash care", "wash_care"],
] as const;

export default async function ProductPage({ params }: Props) {
  const { productSlug } = await params;
  const product = await getProductBySlug(productSlug);

  if (!product) {
    // A renamed slug keeps its link equity: permanently redirect to the
    // current URL. Next emits 308, which Google treats as 301 does.
    const currentSlug = await getRedirectForSlug(productSlug);
    if (currentSlug) permanentRedirect(`/product/${currentSlug}`);
    notFound();
  }

  const store = product.storeFull;
  const [reviews, related, moreFromStore] = await Promise.all([
    getApprovedReviews(product.id),
    getRelatedProducts(product),
    store ? getStoreProducts(store.id, 6, product.id) : Promise.resolve([]),
  ]);

  const availability = inStock(product);

  const trail: Crumb[] = [
    { name: "Home", href: "/" },
    ...(product.category
      ? [{ name: product.category.name, href: `/category/${product.category.slug}` }]
      : []),
    { name: product.name, href: `/product/${product.slug}` },
  ];

  const specs = SPEC_FIELDS.map(([label, key]) => ({
    label,
    value: product[key] as string | null,
  })).filter((s) => s.value);

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16">
        <Breadcrumb trail={trail} />

        <div className="grid gap-10 lg:grid-cols-2">
          <ProductGallery media={product.media} productName={product.name} />

          <div>
            {store && (
              <Link
                href={`/store/${store.slug}`}
                className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-600"
              >
                <StoreIcon className="h-4 w-4" />
                {store.name}
              </Link>
            )}

            <h1 className="font-display text-3xl font-semibold leading-tight text-ink-900">
              {product.name}
            </h1>

            <div className="mt-3 flex items-center gap-3">
              <Rating value={Number(product.rating_avg)} count={product.rating_count} />
              {!availability && <Badge tone="danger">Out of stock</Badge>}
            </div>

            {product.short_description && (
              <p className="mt-4 text-ink-600">{product.short_description}</p>
            )}

            <div className="mt-7">
              <VariantPicker
                productId={product.id}
                basePrice={product.price}
                compareAtPrice={product.compare_at_price}
                options={product.options}
                variants={product.variants}
              />
            </div>

            {/* Per-seller fulfilment reality (spec §5, §13): this ships from one
                store, separately from anything else in the bag. */}
            <div className="mt-8 space-y-3 rounded-2xl border border-line bg-surface p-5 text-sm">
              <div className="flex gap-3">
                <Package className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                <p className="text-ink-600">
                  Ships directly from {store?.name ?? "this store"}
                  {store?.city ? ` in ${store.city}` : ""}. Items from other stores arrive as
                  separate packages.
                </p>
              </div>
              {store?.return_policy && (
                <div className="flex gap-3">
                  <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <p className="text-ink-600">{store.return_policy}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* DESCRIPTION + SPECS */}
        {(product.description || specs.length > 0) && (
          <section className="mt-16 grid gap-10 lg:grid-cols-2">
            {product.description && (
              <div>
                <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">
                  Product details
                </h2>
                <div className="prose prose-sm max-w-none text-ink-600">
                  {product.description.split("\n").filter(Boolean).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </div>
            )}

            {specs.length > 0 && (
              <div>
                <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">
                  Specifications
                </h2>
                <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                  {specs.map((spec) => (
                    <div key={spec.label} className="flex gap-4 bg-surface px-4 py-3 text-sm">
                      <dt className="w-32 shrink-0 text-ink-500">{spec.label}</dt>
                      <dd className="capitalize text-ink-800">{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
        )}

        {/* STORE CARD */}
        {store && (
          <section className="mt-16">
            <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-surface p-6">
              <div className="h-16 w-16 overflow-hidden rounded-xl bg-ink-100">
                {store.logo_url && (
                  <Image
                    src={store.logo_url}
                    alt=""
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold text-ink-900">{store.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-500">
                  {store.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {store.city}
                    </span>
                  )}
                  <span>{store.product_count} products</span>
                  <Rating value={Number(store.rating_avg)} count={store.rating_count} />
                </div>
              </div>
              <Link
                href={`/store/${store.slug}`}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-800 hover:bg-ink-100"
              >
                Visit store
              </Link>
            </div>
          </section>
        )}

        {/* REVIEWS — verified purchases only (spec §39) */}
        <section className="mt-16">
          <h2 className="mb-5 font-display text-xl font-semibold text-ink-900">
            Reviews {product.rating_count > 0 && `(${product.rating_count})`}
          </h2>
          {reviews.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-400">
              No reviews yet. Only customers who bought this product can review it.
            </p>
          ) : (
            <ul className="space-y-4">
              {reviews.map((review) => (
                <li key={review.id} className="rounded-2xl border border-line bg-surface p-5">
                  <div className="flex items-center gap-3">
                    <Rating value={review.rating} count={1} />
                    <span className="text-sm font-medium text-ink-800">
                      {review.customer?.full_name || "Verified shopper"}
                    </span>
                    {review.verified_purchase && <Badge tone="success">Verified purchase</Badge>}
                  </div>
                  {review.body && <p className="mt-3 text-sm text-ink-600">{review.body}</p>}
                  {review.seller_response && (
                    <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
                      <span className="font-medium text-ink-800">Store response: </span>
                      <span className="text-ink-600">{review.seller_response}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {moreFromStore.length > 0 && (
          <section className="mt-16">
            <h2 className="mb-6 font-display text-xl font-semibold text-ink-900">
              More from {store?.name}
            </h2>
            <ProductGrid products={moreFromStore} />
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="mb-6 font-display text-xl font-semibold text-ink-900">
              You may also like
            </h2>
            <ProductGrid products={related} />
          </section>
        )}
      </main>
      <SiteFooter />
      <StructuredData
        data={[productJsonLd(product, availability), breadcrumbJsonLd(trail)]}
      />
    </>
  );
}
