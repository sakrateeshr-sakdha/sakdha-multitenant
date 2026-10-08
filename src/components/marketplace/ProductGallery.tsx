"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductMedia } from "@/lib/db/types";

export function ProductGallery({
  media,
  productName,
}: {
  media: ProductMedia[];
  productName: string;
}) {
  const images = media.filter((m) => m.type === "image");
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="grid aspect-[3/4] place-items-center rounded-2xl bg-ink-100 text-ink-300">
        <span className="font-display text-2xl">Sakdha</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col-reverse gap-4 md:flex-row">
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto md:flex-col md:overflow-visible">
          {images.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              aria-current={i === active}
              className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${
                i === active ? "border-brand-600" : "border-transparent hover:border-line"
              }`}
            >
              <Image src={m.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-ink-100">
        <Image
          src={images[active].url}
          alt={productName}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
    </div>
  );
}
