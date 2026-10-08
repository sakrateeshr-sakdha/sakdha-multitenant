import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ListingView } from "@/components/marketplace/ListingView";
import { StructuredData } from "@/components/seo/StructuredData";
import { getCategoryBySlug, getFacets, listProducts } from "@/lib/db/catalog";
import { breadcrumbJsonLd, categoryMetadata } from "@/lib/seo";
import { buildFacetGroups, hasActiveFilters, parseListingParams, type RawSearchParams } from "@/lib/listing";

type Props = {
  params: Promise<{ cat: string; sub: string }>;
  searchParams: Promise<RawSearchParams>;
};

export const revalidate = 300;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cat, sub } = await params;
  const sp = await searchParams;
  const [parent, category] = await Promise.all([getCategoryBySlug(cat), getCategoryBySlug(sub)]);
  if (!parent || !category) return { title: "Category not found" };

  const filters = parseListingParams(sp);
  const { total } = await listProducts({ ...filters, categoryIds: [category.id], pageSize: 1 });

  const meta = categoryMetadata(category, { productCount: total, page: filters.page, parent });
  if (hasActiveFilters(filters)) {
    return { ...meta, robots: { index: false, follow: true } };
  }
  return meta;
}

export default async function SubcategoryPage({ params, searchParams }: Props) {
  const { cat, sub } = await params;
  const sp = await searchParams;

  const [parent, category] = await Promise.all([getCategoryBySlug(cat), getCategoryBySlug(sub)]);
  if (!parent || !category) notFound();

  // Only one canonical path per subcategory: a mismatched parent redirects to
  // the real one instead of serving duplicate content under two URLs.
  if (category.parent_id !== parent.id) {
    redirect(`/category/${category.slug}`);
  }

  const filters = parseListingParams(sp);
  const [result, facets] = await Promise.all([
    listProducts({ ...filters, categoryIds: [category.id] }),
    getFacets({ categoryIds: [category.id] }),
  ]);

  if (result.page > 1 && result.page > result.pageCount) notFound();

  const trail = [
    { name: "Home", href: "/" },
    { name: parent.name, href: `/category/${parent.slug}` },
    { name: category.name, href: `/category/${parent.slug}/${category.slug}` },
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

        <ListingView
          result={result}
          facets={buildFacetGroups(facets)}
          basePath={`/category/${parent.slug}/${category.slug}`}
          searchParams={sp}
          emptyMessage={`No ${category.name.toLowerCase()} listed yet.`}
        />
      </main>
      <SiteFooter />
      <StructuredData data={breadcrumbJsonLd(trail)} />
    </>
  );
}
