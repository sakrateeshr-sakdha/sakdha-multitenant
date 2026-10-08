import Link from "next/link";
import { ArrowRight, Store, Truck, BadgeIndianRupee } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Button } from "@/components/ui/Button";
import { ProductGrid } from "@/components/marketplace/ProductGrid";
import { StoreCard } from "@/components/marketplace/StoreCard";
import { StructuredData } from "@/components/seo/StructuredData";
import { getCategoryTree, getTrendingProducts, listStores } from "@/lib/db/catalog";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";

export const revalidate = 300;

export default async function HomePage() {
  const [trending, categories, stores] = await Promise.all([
    getTrendingProducts(8),
    getCategoryTree(),
    listStores({ pageSize: 3 }),
  ]);

  // Top-level categories only — children belong on the category page.
  const topCategories = categories.filter((c) => !c.parent_id).slice(0, 8);

  return (
    <>
      <SiteHeader />
      <main>
        {/* HERO */}
        <section className="border-b border-line bg-gradient-to-b from-brand-50/60 to-surface-2">
          <div className="container-content grid gap-8 py-16 md:grid-cols-2 md:py-24">
            <div className="flex flex-col justify-center">
              <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-600">
                Fashion stores across India, in one marketplace
              </span>
              <h1 className="font-display text-4xl font-semibold leading-tight text-ink-900 md:text-6xl">
                Discover Fashion Stores. Shop Everything You Love.
              </h1>
              <p className="mt-5 max-w-md text-lg text-ink-500">
                One cart. One payment. Delivered as separate shipments from independent
                fashion stores you&apos;ll love.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/stores" size="lg">
                  Start shopping <ArrowRight className="h-4 w-4" />
                </Button>
                <Button href="/sell" size="lg" variant="outline">
                  Sell on Sakdha
                </Button>
              </div>
            </div>
            <div className="hidden items-center justify-center md:flex">
              <div className="aspect-[4/5] w-full max-w-sm rounded-3xl bg-gradient-to-br from-brand-200 to-brand-400/70" />
            </div>
          </div>
        </section>

        {/* SHOP BY CATEGORY */}
        {topCategories.length > 0 && (
          <section className="container-content py-14">
            <div className="mb-6 flex items-end justify-between">
              <h2 className="font-display text-2xl font-semibold text-ink-900">
                Shop by Category
              </h2>
              <Link
                href="/stores"
                className="text-sm font-medium text-brand-600 hover:underline"
              >
                Explore stores
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
              {topCategories.map((c) => (
                <Link
                  key={c.id}
                  href={`/category/${c.slug}`}
                  className="group flex flex-col items-center gap-2"
                >
                  <div className="aspect-square w-full rounded-2xl bg-ink-100 transition group-hover:bg-brand-50" />
                  <span className="text-center text-sm font-medium text-ink-700 group-hover:text-brand-600">
                    {c.name}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* SELLER PROPOSITION */}
        <section className="container-content py-6">
          <div className="grid gap-4 rounded-3xl border border-line bg-surface p-8 md:grid-cols-3">
            {[
              { icon: Store, title: "Start selling for ₹0", body: "No subscription. Launch your online fashion store in minutes." },
              { icon: BadgeIndianRupee, title: "Pay only 2% per sale", body: "A simple 2% marketplace commission on product value — nothing else." },
              { icon: Truck, title: "You ship, we settle", body: "Dispatch within your SLA; settlements land via Razorpay Route." },
            ].map((f) => (
              <div key={f.title} className="flex gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <f.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-medium text-ink-900">{f.title}</h3>
                  <p className="mt-1 text-sm text-ink-500">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* TRENDING */}
        <section className="container-content py-14">
          <h2 className="mb-6 font-display text-2xl font-semibold text-ink-900">
            Trending Now
          </h2>
          {trending.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
              Products from live stores appear here once sellers go live.
            </div>
          ) : (
            <ProductGrid products={trending} />
          )}
        </section>

        {/* FEATURED STORES */}
        {stores.items.length > 0 && (
          <section className="container-content pb-16">
            <div className="mb-6 flex items-end justify-between">
              <h2 className="font-display text-2xl font-semibold text-ink-900">
                Stores to know
              </h2>
              <Link href="/stores" className="text-sm font-medium text-brand-600 hover:underline">
                All stores
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {stores.items.map((store) => (
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
          </section>
        )}
      </main>
      <SiteFooter />
      <StructuredData data={[organizationJsonLd(), websiteJsonLd()]} />
    </>
  );
}
