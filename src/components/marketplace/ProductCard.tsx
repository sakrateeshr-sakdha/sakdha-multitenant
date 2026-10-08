import Link from "next/link";
import Image from "next/image";
import { Price } from "@/components/ui/Price";
import { Rating } from "@/components/ui/Rating";
import { WishlistButton } from "@/components/marketplace/WishlistButton";

export type ProductCardData = {
  id?: string;
  savedToWishlist?: boolean;
  slug: string;
  name: string;
  price: number;
  compareAt?: number | null;
  imageUrl?: string | null;
  storeName?: string;
  storeSlug?: string;
  ratingAvg?: number;
  ratingCount?: number;
};

/** The core discovery unit (spec §28). Image, store, name, price, rating. */
export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <div className="group relative">
      <Link href={`/product/${product.slug}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-ink-100">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-300">
              <span className="font-display text-lg">Sakdha</span>
            </div>
          )}
        </div>
      </Link>

      {product.id && (
        <WishlistButton
          productId={product.id}
          initiallySaved={product.savedToWishlist}
          className="absolute right-3 top-3"
        />
      )}

      <div className="mt-3 space-y-1">
        {product.storeSlug && product.storeName && (
          <Link
            href={`/store/${product.storeSlug}`}
            className="text-xs font-medium uppercase tracking-wide text-ink-400 hover:text-brand-600"
          >
            {product.storeName}
          </Link>
        )}
        <Link href={`/product/${product.slug}`} className="block">
          <h3 className="line-clamp-1 text-sm font-medium text-ink-800">{product.name}</h3>
        </Link>
        <Price price={product.price} compareAt={product.compareAt} size="sm" />
        <Rating value={product.ratingAvg ?? 0} count={product.ratingCount} />
      </div>
    </div>
  );
}
