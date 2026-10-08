import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Button } from "@/components/ui/Button";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your wishlist",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type WishlistRow = {
  product_id: string;
  products: {
    id: string;
    slug: string;
    name: string;
    price: number;
    compare_at_price: number | null;
    rating_avg: number;
    rating_count: number;
    status: string;
    stores: { name: string; slug: string } | null;
    product_media: { url: string; position: number; type: string }[] | null;
  } | null;
};

export default async function WishlistPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("wishlist_items")
    .select(
      `
      product_id,
      products:product_id (
        id, slug, name, price, compare_at_price, rating_avg, rating_count, status,
        stores:store_id ( name, slug ),
        product_media ( url, position, type )
      )
    `
    )
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });

  // A saved product that was later archived is hidden by RLS and joins as null.
  const items = ((data ?? []) as unknown as WishlistRow[])
    .map((row) => row.products)
    .filter((p): p is NonNullable<WishlistRow["products"]> => Boolean(p));

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900">Your wishlist</h1>
        <p className="mt-2 text-sm text-ink-500">
          {items.length} {items.length === 1 ? "item" : "items"} saved
        </p>

        {items.length === 0 ? (
          <div className="mt-12 text-center">
            <Heart className="mx-auto h-10 w-10 text-ink-300" />
            <h2 className="mt-4 font-display text-xl font-semibold text-ink-900">
              Nothing saved yet
            </h2>
            <p className="mt-2 text-ink-500">
              Tap the heart on anything you like and it will wait for you here.
            </p>
            <div className="mt-7">
              <Button href="/stores" size="lg">
                Explore stores
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((product) => {
              const image = (product.product_media ?? [])
                .filter((m) => m.type === "image")
                .sort((a, b) => a.position - b.position)[0];
              return (
                <ProductCard
                  key={product.id}
                  product={{
                    id: product.id,
                    savedToWishlist: true,
                    slug: product.slug,
                    name: product.name,
                    price: product.price,
                    compareAt: product.compare_at_price,
                    imageUrl: image?.url ?? null,
                    storeName: product.stores?.name,
                    storeSlug: product.stores?.slug,
                    ratingAvg: Number(product.rating_avg),
                    ratingCount: product.rating_count,
                  }}
                />
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
