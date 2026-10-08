import { ProductGrid } from "@/components/marketplace/ProductGrid";
import { FilterPanel, SortSelect, type FacetGroup } from "@/components/marketplace/FilterPanel";
import { Pagination } from "@/components/ui/Pagination";
import type { ProductPage } from "@/lib/db/catalog";
import type { RawSearchParams } from "@/lib/listing";

/**
 * Shared layout for every product listing (category, store, search, city) so
 * filters, sort, grid, count and pagination behave identically everywhere.
 */
export function ListingView({
  result,
  facets,
  basePath,
  searchParams,
  emptyMessage = "No products match this view yet.",
}: {
  result: ProductPage;
  facets: FacetGroup[];
  basePath: string;
  searchParams: RawSearchParams;
  emptyMessage?: string;
}) {
  return (
    <div className="flex gap-10">
      <FilterPanel facets={facets} />

      <div className="min-w-0 flex-1">
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-sm text-ink-500">
            {result.total === 0
              ? "No products"
              : `${result.total.toLocaleString("en-IN")} ${result.total === 1 ? "product" : "products"}`}
          </p>
          <SortSelect />
        </div>

        {result.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
            {emptyMessage}
          </div>
        ) : (
          <>
            <ProductGrid products={result.items} />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              basePath={basePath}
              searchParams={searchParams}
            />
          </>
        )}
      </div>
    </div>
  );
}
