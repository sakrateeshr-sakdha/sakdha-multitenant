import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ListingView } from "@/components/marketplace/ListingView";
import { getFacets, listProducts, listStores } from "@/lib/db/catalog";
import { buildFacetGroups, parseListingParams, type RawSearchParams } from "@/lib/listing";

type Props = { searchParams: Promise<RawSearchParams> };

/** Internal search results are never indexed (spec §51 robots guardrail). */
export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseListingParams(sp);
  const query = filters.q;

  if (!query) {
    return (
      <>
        <SiteHeader />
        <main className="container-content py-20 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            What are you looking for?
          </h1>
          <p className="mt-3 text-ink-500">
            Search for products, fabrics or store names from the bar above.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [result, facets, stores] = await Promise.all([
    listProducts(filters),
    getFacets({ q: query }),
    listStores({ q: query, pageSize: 4 }),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <header className="mb-8">
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            Results for &ldquo;{query}&rdquo;
          </h1>
        </header>

        {/* Matching stores surface above products — a store is often the intent. */}
        {stores.items.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
              Stores
            </h2>
            <div className="flex flex-wrap gap-3">
              {stores.items.map((store) => (
                <Link
                  key={store.id}
                  href={`/store/${store.slug}`}
                  className="rounded-xl border border-line bg-surface px-4 py-3 text-sm transition hover:border-brand-300"
                >
                  <span className="font-medium text-ink-900">{store.name}</span>
                  <span className="ml-2 text-ink-400">{store.product_count} products</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <ListingView
          result={result}
          facets={buildFacetGroups(facets)}
          basePath="/search"
          searchParams={sp}
          emptyMessage={`Nothing matched "${query}". Try a different word or browse a category.`}
        />
      </main>
      <SiteFooter />
    </>
  );
}
