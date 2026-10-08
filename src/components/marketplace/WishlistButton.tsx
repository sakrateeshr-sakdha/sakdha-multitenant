"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Heart } from "lucide-react";
import { toggleWishlist } from "@/lib/actions/wishlist";
import { rememberReturnTo } from "@/lib/actions/auth";

export function WishlistButton({
  productId,
  initiallySaved = false,
  className = "",
}: {
  productId: string;
  initiallySaved?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();

  const onClick = (e: React.MouseEvent) => {
    // The button sits inside a product card link.
    e.preventDefault();
    e.stopPropagation();

    // Optimistic: the toggle is cheap and reverts if the server disagrees.
    const next = !saved;
    setSaved(next);

    startTransition(async () => {
      const result = await toggleWishlist(productId);
      if (!result.ok) {
        setSaved(!next);
        toast.error(result.message);
        if (result.reason === "AUTH_REQUIRED") {
          await rememberReturnTo(window.location.pathname);
          router.push("/login");
        }
        return;
      }
      setSaved(result.saved);
      router.refresh();
    });
  };

  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label={saved ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={saved}
      className={`grid h-9 w-9 place-items-center rounded-full bg-surface/90 shadow-sm backdrop-blur transition hover:text-brand-600 ${
        saved ? "text-brand-600" : "text-ink-600"
      } ${className}`}
    >
      <Heart className={`h-4 w-4 ${saved ? "fill-brand-600" : ""}`} />
    </button>
  );
}
