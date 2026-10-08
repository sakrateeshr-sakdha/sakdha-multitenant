import { ProductCard } from "@/components/marketplace/ProductCard";
import type { ProductListItem } from "@/lib/db/types";

export function toCardData(p: ProductListItem) {
  const image = p.media.find((m) => m.type === "image");
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    compareAt: p.compare_at_price,
    imageUrl: image?.url ?? null,
    storeName: p.store?.name,
    storeSlug: p.store?.slug,
    ratingAvg: Number(p.rating_avg),
    ratingCount: p.rating_count,
  };
}

export function ProductGrid({
  products,
  className = "",
}: {
  products: ProductListItem[];
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 ${className}`}
    >
      {products.map((p) => (
        <ProductCard key={p.id} product={toCardData(p)} />
      ))}
    </div>
  );
}

/** Loading placeholder matching the grid's geometry (no layout shift). */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="skeleton aspect-[3/4] w-full rounded-2xl" />
          <div className="skeleton mt-3 h-3 w-20" />
          <div className="skeleton mt-2 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
