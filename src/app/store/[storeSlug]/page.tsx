import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { MapPin, Package, RotateCcw } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Rating } from "@/components/ui/Rating";
import { ListingView } from "@/components/marketplace/ListingView";
import { StructuredData } from "@/components/seo/StructuredData";
import { getFacets, getStoreBySlug, listProducts } from "@/lib/db/catalog";
import { breadcrumbJsonLd, storeJsonLd, storeMetadata } from "@/lib/seo";
import { buildFacetGroups, hasActiveFilters, parseListingParams, type RawSearchParams } from "@/lib/listing";

type Props = {
  params: Promise<{ storeSlug: string }>;
  searchParams: Promise<RawSearchParams>;
};

export const revalidate = 300;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await getStoreBySlug(storeSlug);
  if (!store) return { title: "Store not found" };

  const meta = storeMetadata(store);
  const filters = parseListingParams(await searchParams);
  if (hasActiveFilters(filters) || (filters.page ?? 1) > 1) {
    return { ...meta, robots: { index: false, follow: true } };
  }
  return meta;
}

export default async function StorePage({ params, searchParams }: Props) {
  const { storeSlug } = await params;
  const sp = await searchParams;
  const store = await getStoreBySlug(storeSlug);
  if (!store) notFound();

  const filters = parseListingParams(sp);
  const [result, facets] = await Promise.all([
    listProducts({ ...filters, storeId: store.id }),
    getFacets({ storeId: store.id }),
  ]);

  if (result.page > 1 && result.page > result.pageCount) notFound();

  const trail = [
    { name: "Home", href: "/" },
    { name: "Stores", href: "/stores" },
    { name: store.name, href: `/store/${store.slug}` },
  ];

  return (
    <>
      <SiteHeader />
      <main className="pb-16">
        {/* STOREFRONT HEADER — stores should feel like their own mini site. */}
        <div className="relative h-40 bg-gradient-to-br from-brand-100 to-brand-300/60 md:h-56">
          {store.cover_url && (
            <Image
              src={store.cover_url}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          )}
        </div>

        <div className="container-content">
          <div className="-mt-12 flex flex-wrap items-end gap-5">
            <div className="h-24 w-24 overflow-hidden rounded-2xl border-4 border-surface bg-ink-100 shadow-card">
              {store.logo_url && (
                <Image
                  src={store.logo_url}
                  alt=""
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="flex-1 pb-1">
              <h1 className="font-display text-3xl font-semibold text-ink-900">{store.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-ink-500">
                {store.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {store.city}
                    {store.state ? `, ${store.state}` : ""}
                  </span>
                )}
                <span>{store.product_count} products</span>
                <Rating value={Number(store.rating_avg)} count={store.rating_count} />
              </div>
            </div>
          </div>

          <Breadcrumb trail={trail} />

          {store.description && (
            <p className="mb-6 max-w-2xl text-ink-600">{store.description}</p>
          )}

          {(store.shipping_info || store.return_policy) && (
            <div className="mb-8 grid gap-3 rounded-2xl border border-line bg-surface p-5 text-sm md:grid-cols-2">
              {store.shipping_info && (
                <div className="flex gap-3">
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <p className="text-ink-600">{store.shipping_info}</p>
                </div>
              )}
              {store.return_policy && (
                <div className="flex gap-3">
                  <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <p className="text-ink-600">{store.return_policy}</p>
                </div>
              )}
            </div>
          )}

          <ListingView
            result={result}
            facets={buildFacetGroups(facets)}
            basePath={`/store/${store.slug}`}
            searchParams={sp}
            emptyMessage={`${store.name} hasn't listed any products yet.`}
          />
        </div>
      </main>
      <SiteFooter />
      <StructuredData data={[storeJsonLd(store), breadcrumbJsonLd(trail)]} />
    </>
  );
}
