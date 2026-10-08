import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { StoreCard } from "@/components/marketplace/StoreCard";
import { Pagination } from "@/components/ui/Pagination";
import { StructuredData } from "@/components/seo/StructuredData";
import { listStoreCities, listStores } from "@/lib/db/catalog";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/seo";
import type { RawSearchParams } from "@/lib/listing";

type Props = { searchParams: Promise<RawSearchParams> };

export const revalidate = 600;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const page = Number.parseInt((Array.isArray(sp.page) ? sp.page[0] : sp.page) ?? "1", 10) || 1;
  return buildMetadata({
    title: `Fashion Stores${page > 1 ? ` — Page ${page}` : ""}`,
    description:
      "Browse independent fashion stores across India. Each store ships directly to you.",
    path: page > 1 ? `/stores?page=${page}` : "/stores",
  });
}

export default async function StoresPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Number.parseInt((Array.isArray(sp.page) ? sp.page[0] : sp.page) ?? "1", 10) || 1;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim();

  const [result, cities] = await Promise.all([listStores({ page, q }), listStoreCities()]);

  if (result.page > 1 && result.page > result.pageCount) notFound();

  const trail = [
    { name: "Home", href: "/" },
    { name: "Stores", href: "/stores" },
  ];

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16">
        <Breadcrumb trail={trail} />

        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
            Fashion stores on Sakdha
          </h1>
          <p className="mt-3 max-w-2xl text-ink-500">
            Independent fashion stores across India. Buy from several in one order — each
            ships your items directly.
          </p>
        </header>

        {/* City links — local discovery + internal linking (spec §23, §50). */}
        {cities.length > 0 && (
          <nav aria-label="Stores by city" className="mb-8 flex flex-wrap gap-2">
            {cities.map((city) => (
              <Link
                key={city}
                href={`/city/${encodeURIComponent(city.toLowerCase())}/stores`}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink-700 transition hover:border-brand-300 hover:text-brand-600"
              >
                Stores in {city}
              </Link>
            ))}
          </nav>
        )}

        <p className="mb-5 text-sm text-ink-500">
          {result.total === 0
            ? "No stores yet"
            : `${result.total.toLocaleString("en-IN")} ${result.total === 1 ? "store" : "stores"}`}
        </p>

        {result.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
            No live stores yet. Sellers appear here once their first product goes live.
          </div>
        ) : (
          <>
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
              basePath="/stores"
              searchParams={sp}
            />
          </>
        )}
      </main>
      <SiteFooter />
      <StructuredData data={breadcrumbJsonLd(trail)} />
    </>
  );
}
