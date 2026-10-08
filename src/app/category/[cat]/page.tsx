import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ListingView } from "@/components/marketplace/ListingView";
import { StructuredData } from "@/components/seo/StructuredData";
import {
  getCategoryBySlug,
  getCategoryScopeIds,
  getChildCategories,
  getFacets,
  listProducts,
} from "@/lib/db/catalog";
import { breadcrumbJsonLd, categoryMetadata } from "@/lib/seo";
import { buildFacetGroups, hasActiveFilters, parseListingParams, type RawSearchParams } from "@/lib/listing";

type Props = {
  params: Promise<{ cat: string }>;
  searchParams: Promise<RawSearchParams>;
};

export const revalidate = 300;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cat } = await params;
  const sp = await searchParams;
  const category = await getCategoryBySlug(cat);
  if (!category) return { title: "Category not found" };

  const filters = parseListingParams(sp);
  const scopeIds = await getCategoryScopeIds(category);
  const { total } = await listProducts({ ...filters, categoryIds: scopeIds, pageSize: 1 });

  const meta = categoryMetadata(category, { productCount: total, page: filters.page });
  // A filtered permutation is a crawl trap — keep it out of the index.
  if (hasActiveFilters(filters)) {
    return { ...meta, robots: { index: false, follow: true } };
  }
  return meta;
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { cat } = await params;
  const sp = await searchParams;
  const category = await getCategoryBySlug(cat);
  if (!category) notFound();

  const filters = parseListingParams(sp);
  const scopeIds = await getCategoryScopeIds(category);

  const [result, facets, children] = await Promise.all([
    listProducts({ ...filters, categoryIds: scopeIds }),
    getFacets({ categoryIds: scopeIds }),
    getChildCategories(category.id),
  ]);

  // Page 5 of a 2-page category is not a real page — 404 rather than serve an
  // empty 200 that a crawler would treat as valid.
  if (result.page > 1 && result.page > result.pageCount) notFound();

  const trail = [
    { name: "Home", href: "/" },
    { name: category.name, href: `/category/${category.slug}` },
  ];

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16">
        <Breadcrumb trail={trail} />

        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
            {category.name}
          </h1>
          {category.intro_md && (
            <p className="mt-3 max-w-2xl text-ink-500">{category.intro_md}</p>
          )}
        </header>

        {/* Subcategory links — internal linking per spec §50. */}
        {children.length > 0 && (
          <nav aria-label="Subcategories" className="mb-8 flex flex-wrap gap-2">
            {children.map((child) => (
              <Link
                key={child.id}
                href={`/category/${category.slug}/${child.slug}`}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink-700 transition hover:border-brand-300 hover:text-brand-600"
              >
                {child.name}
              </Link>
            ))}
          </nav>
        )}

        <ListingView
          result={result}
          facets={buildFacetGroups(facets)}
          basePath={`/category/${category.slug}`}
          searchParams={sp}
          emptyMessage={`No ${category.name.toLowerCase()} listed yet. Check back as stores go live.`}
        />
      </main>
      <SiteFooter />
      <StructuredData data={breadcrumbJsonLd(trail)} />
    </>
  );
}
