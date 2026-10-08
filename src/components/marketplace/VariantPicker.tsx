"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Price } from "@/components/ui/Price";
import { addToBag } from "@/lib/actions/cart";
import { rememberReturnTo } from "@/lib/actions/auth";
import type { ProductOption, ProductVariant } from "@/lib/db/types";

/**
 * Option selection + quantity + add to bag.
 *
 * Variants are matched by comparing the selected {option: value} map against
 * each variant's option_values_json. Stock shown is inventory minus the part
 * already reserved by in-flight checkouts.
 */
export function VariantPicker({
  productId,
  basePrice,
  compareAtPrice,
  options,
  variants,
}: {
  productId: string;
  basePrice: number;
  compareAtPrice: number | null;
  options: ProductOption[];
  variants: ProductVariant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);

  // Distinct values per option, in the order variants declare them.
  const valuesByOption = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const option of options) {
      const seen: string[] = [];
      for (const variant of variants) {
        const value = variant.option_values_json?.[option.name];
        if (value && !seen.includes(value)) seen.push(value);
      }
      map.set(option.name, seen);
    }
    return map;
  }, [options, variants]);

  const activeVariant = useMemo(() => {
    if (options.length === 0) return null;
    if (options.some((o) => !selected[o.name])) return null;
    return (
      variants.find((v) =>
        options.every((o) => v.option_values_json?.[o.name] === selected[o.name])
      ) ?? null
    );
  }, [options, variants, selected]);

  const available = (variant: ProductVariant) => variant.inventory_qty - variant.reserved_qty;

  /** Is this option value reachable given the other selections? */
  const valueInStock = (optionName: string, value: string) =>
    variants.some(
      (v) =>
        v.option_values_json?.[optionName] === value &&
        available(v) > 0 &&
        Object.entries(selected).every(
          ([key, val]) => key === optionName || v.option_values_json?.[key] === val
        )
    );

  const needsSelection = options.length > 0 && !activeVariant;
  const simpleProduct = options.length === 0;
  const stock = activeVariant ? available(activeVariant) : null;
  const soldOut = activeVariant ? stock! <= 0 : !simpleProduct && variants.every((v) => available(v) <= 0);
  const price = activeVariant?.price_override ?? basePrice;

  const onAdd = () => {
    if (needsSelection) {
      toast.error(`Choose a ${options.find((o) => !selected[o.name])?.name.toLowerCase()}`);
      return;
    }
    startTransition(async () => {
      const result = await addToBag({
        productId,
        variantId: activeVariant?.id ?? null,
        qty,
      });
      if (result.ok) {
        toast.success("Added to your bag");
        router.refresh();
      } else if (result.reason === "AUTH_REQUIRED") {
        toast.error(result.message);
        // Hand the destination to the server as a cookie rather than a URL
        // parameter, so sign-in brings them back to this product page.
        await rememberReturnTo(window.location.pathname);
        router.push("/login");
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Price price={price} compareAt={compareAtPrice} size="lg" />

      {options.map((option) => {
        const values = valuesByOption.get(option.name) ?? [];
        if (values.length === 0) return null;
        return (
          <div key={option.id}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium text-ink-900">{option.name}</span>
              {selected[option.name] && (
                <span className="text-sm text-ink-500">{selected[option.name]}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => {
                const isSelected = selected[option.name] === value;
                const reachable = valueInStock(option.name, value);
                return (
                  <button
                    key={value}
                    onClick={() =>
                      setSelected((prev) => ({ ...prev, [option.name]: value }))
                    }
                    disabled={!reachable}
                    aria-pressed={isSelected}
                    className={`min-w-11 rounded-xl border px-3 py-2 text-sm transition ${
                      isSelected
                        ? "border-brand-600 bg-brand-50 text-brand-700"
                        : "border-line text-ink-700 hover:border-ink-300"
                    } ${!reachable ? "cursor-not-allowed text-ink-300 line-through hover:border-line" : ""}`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {stock != null && stock > 0 && stock <= 5 && (
        <p className="text-sm font-medium text-warning">Only {stock} left</p>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-xl border border-line">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
            className="grid h-11 w-11 place-items-center text-ink-600 disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-sm font-medium">{qty}</span>
          <button
            onClick={() => setQty((q) => Math.min(10, stock ?? 10, q + 1))}
            disabled={qty >= Math.min(10, stock ?? 10)}
            aria-label="Increase quantity"
            className="grid h-11 w-11 place-items-center text-ink-600 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <Button size="lg" onClick={onAdd} disabled={pending || soldOut} className="flex-1">
          <ShoppingBag className="h-4 w-4" />
          {soldOut ? "Sold out" : pending ? "Adding…" : "Add to bag"}
        </Button>
      </div>
    </div>
  );
}
