import Link from "next/link";
import Image from "next/image";
import { MapPin } from "lucide-react";
import { Rating } from "@/components/ui/Rating";

export type StoreCardData = {
  slug: string;
  name: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  city?: string | null;
  productCount?: number;
  ratingAvg?: number;
  ratingCount?: number;
};

/** Store discovery unit (spec §46) — stores feel like mini fashion sites. */
export function StoreCard({ store }: { store: StoreCardData }) {
  return (
    <Link
      href={`/store/${store.slug}`}
      className="group block overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:shadow-card-hover"
    >
      <div className="relative h-28 bg-ink-100">
        {store.coverUrl && (
          <Image src={store.coverUrl} alt="" fill sizes="320px" className="object-cover" />
        )}
      </div>
      <div className="px-4 pb-4">
        <div className="-mt-7 mb-2 h-14 w-14 overflow-hidden rounded-xl border-2 border-surface bg-ink-200">
          {store.logoUrl && (
            <Image src={store.logoUrl} alt="" width={56} height={56} className="h-full w-full object-cover" />
          )}
        </div>
        <h3 className="font-medium text-ink-900 group-hover:text-brand-600">{store.name}</h3>
        <div className="mt-1 flex items-center gap-3 text-xs text-ink-500">
          {store.city && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {store.city}
            </span>
          )}
          {store.productCount != null && <span>{store.productCount} products</span>}
        </div>
        <div className="mt-1">
          <Rating value={store.ratingAvg ?? 0} count={store.ratingCount} />
        </div>
      </div>
    </Link>
  );
}
