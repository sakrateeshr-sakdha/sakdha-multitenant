"use client";

import { useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Minus, Plus, Trash2 } from "lucide-react";
import { formatINR } from "@/lib/money";
import { removeCartItem, updateCartQty } from "@/lib/actions/cart";
import type { CartLine } from "@/lib/db/cart";

export function CartLineRow({ line }: { line: CartLine }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.message ?? "Something went wrong");
      router.refresh();
    });

  const priceChanged = line.snapshotPrice !== line.unitPrice;

  return (
    <div className={`flex gap-4 py-5 ${pending ? "opacity-60" : ""}`}>
      <Link
        href={`/product/${line.productSlug}`}
        className="relative h-28 w-21 shrink-0 overflow-hidden rounded-xl bg-ink-100"
        style={{ width: "5.25rem" }}
      >
        {line.imageUrl && (
          <Image src={line.imageUrl} alt="" fill sizes="84px" className="object-cover" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/product/${line.productSlug}`}
          className="font-medium text-ink-900 hover:text-brand-600"
        >
          {line.name}
        </Link>
        {line.optionLabel && (
          <p className="mt-0.5 text-sm text-ink-500">{line.optionLabel}</p>
        )}

        {!line.isAvailable && (
          <p className="mt-1 text-sm font-medium text-danger">{line.unavailableReason}</p>
        )}
        {line.isAvailable && priceChanged && (
          <p className="mt-1 text-xs text-warning">
            Price changed from {formatINR(line.snapshotPrice)} since you added this.
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-line">
            <button
              onClick={() => run(() => updateCartQty(line.id, line.qty - 1))}
              disabled={pending || line.qty <= 1}
              aria-label="Decrease quantity"
              className="grid h-9 w-9 place-items-center text-ink-600 disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-7 text-center text-sm font-medium">{line.qty}</span>
            <button
              onClick={() => run(() => updateCartQty(line.id, line.qty + 1))}
              disabled={pending || line.qty >= Math.min(10, line.available ?? 10)}
              aria-label="Increase quantity"
              className="grid h-9 w-9 place-items-center text-ink-600 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={() => run(() => removeCartItem(line.id))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>

      <div className="text-right">
        <p className="font-semibold text-ink-900">{formatINR(line.lineTotal)}</p>
        {line.qty > 1 && (
          <p className="mt-0.5 text-xs text-ink-400">{formatINR(line.unitPrice)} each</p>
        )}
      </div>
    </div>
  );
}
