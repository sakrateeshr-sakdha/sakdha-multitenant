import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { StoreCard } from "@/components/marketplace/StoreCard";
import { Pagination } from "@/components/ui/Pagination";
import { StructuredData } from "@/components/seo/StructuredData";
import { listStores } from "@/lib/db/catalog";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/seo";
import type { RawSearchParams } from "@/lib/listing";

type Props = {
  params: Promise<{ city: string }>;
  searchParams: Promise<RawSearchParams>;
};

export const revalidate = 600;

/** Local pages only earn indexing once there's real inventory (spec §23). */
const MIN_STORES_TO_INDEX = 3;

const titleCaseCity = (slug: string) =>
  decodeURIComponent(slug)
    .split(/[-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params;
  const cityName = titleCaseCity(city);
  const { total } = await listStores({ city: cityName, pageSize: 1 });

  return buildMetadata({
    title: `Fashion Stores in ${cityName} | Sakdha`,
    description: `Discover ${total} fashion ${total === 1 ? "store" : "stores"} in ${cityName} on Sakdha. Shop directly from local fashion stores.`,
    path: `/city/${city}/stores`,
    noindex: total < MIN_STORES_TO_INDEX,
  });
}

export default async function CityStoresPage({ params, searchParams }: Props) {
  const { city } = await params;
  const sp = await searchParams;
  const cityName = titleCaseCity(city);
  const page = Number.parseInt((Array.isArray(sp.page) ? sp.page[0] : sp.page) ?? "1", 10) || 1;

  const result = await listStores({ city: cityName, page });
  if (result.total === 0) notFound();
  if (result.page > 1 && result.page > result.pageCount) notFound();

  const trail = [
    { name: "Home", href: "/" },
    { name: "Stores", href: "/stores" },
    { name: cityName, href: `/city/${city}/stores` },
  ];

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16">
        <Breadcrumb trail={trail} />

        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
            Fashion stores in {cityName}
          </h1>
          <p className="mt-3 max-w-2xl text-ink-500">
            {result.total} {result.total === 1 ? "store" : "stores"} shipping from {cityName}.
          </p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((store) => (
            <StoreCard
              key={store.id}
              store={{
                slug: store.slug,
                name: store.name,
                logoUrl: store.logo_url,
                coverUrl: store.cover_url,
                city: store.city,
                productCount: store.product_count,
                ratingAvg: Number(store.rating_avg),
                ratingCount: store.rating_count,
              }}
            />
          ))}
        </div>

        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          basePath={`/city/${city}/stores`}
          searchParams={sp}
        />
      </main>
      <SiteFooter />
      <StructuredData data={breadcrumbJsonLd(trail)} />
    </>
  );
}
