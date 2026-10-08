"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ImagePlus, Trash2 } from "lucide-react";
import { deleteProductImage, uploadProductImage } from "@/lib/actions/products";

export type MediaItem = { id: string; url: string; position: number };

export function MediaManager({
  productId,
  media,
}: {
  productId: string;
  media: MediaItem[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);

    // Sequential, so the server-side position counter stays correct and a
    // rejected file does not abort the rest.
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("file", file);
      const result = await uploadProductImage(formData);
      if (!result.ok) {
        toast.error(`${file.name}: ${result.error}`);
        break;
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  };

  const remove = (mediaId: string) =>
    startTransition(async () => {
      const result = await deleteProductImage(mediaId);
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });

  const sorted = [...media].sort((a, b) => a.position - b.position);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-ink-900">Photos</h2>
        <span className="text-xs text-ink-400">{media.length}/8</span>
      </div>
      <p className="mb-5 mt-1 text-sm text-ink-500">
        The first photo is the one shoppers see in listings. JPEG, PNG, WebP or AVIF, up to
        5MB each.
      </p>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {sorted.map((item, i) => (
          <div key={item.id} className="group relative">
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-100">
              <Image src={item.url} alt="" fill sizes="160px" className="object-cover" />
            </div>
            {i === 0 && (
              <span className="absolute left-2 top-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10px] font-medium text-surface">
                Cover
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(item.id)}
              disabled={pending}
              aria-label="Remove photo"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-surface/90 text-ink-600 shadow-sm backdrop-blur transition hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {media.length < 8 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-ink-400 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
          >
            <ImagePlus className="h-6 w-6" />
            <span className="text-xs font-medium">{uploading ? "Uploading…" : "Add photo"}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}
