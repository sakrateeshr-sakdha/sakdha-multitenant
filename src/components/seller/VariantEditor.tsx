"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { saveVariants, type VariantInput } from "@/lib/actions/products";
import { toPaise } from "@/lib/money";

export type VariantRow = {
  id?: string;
  value: string;
  sku: string;
  /** Rupees, as typed. Blank means "use the product price". */
  priceOverride: string;
  inventoryQty: string;
  isActive: boolean;
  reservedQty: number;
};

export function VariantEditor({
  productId,
  initial,
}: {
  productId: string;
  initial: VariantRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<VariantRow[]>(initial);
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<VariantRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { value: "", sku: "", priceOverride: "", inventoryQty: "0", isActive: true, reservedQty: 0 },
    ]);

  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  const save = () => {
    if (rows.some((r) => !r.value.trim())) {
      toast.error("Every row needs a size.");
      return;
    }

    const payload: VariantInput[] = rows.map((r) => ({
      id: r.id,
      value: r.value.trim().toUpperCase(),
      sku: r.sku,
      priceOverride: r.priceOverride.trim() === "" ? null : toPaise(Number(r.priceOverride)),
      inventoryQty: Number(r.inventoryQty || 0),
      isActive: r.isActive,
    }));

    startTransition(async () => {
      const result = await saveVariants(productId, payload);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Sizes saved");
        router.refresh();
      }
    });
  };

  const cellCls =
    "h-10 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-600/30";

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-ink-900">Sizes &amp; stock</h2>
      <p className="mb-5 mt-1 text-sm text-ink-500">
        Leave this empty for a one-size product. Stock held by in-flight checkouts is shown
        separately and cannot be edited away.
      </p>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="pb-2 font-medium">Size</th>
                <th className="pb-2 font-medium">SKU</th>
                <th className="pb-2 font-medium">Price override (₹)</th>
                <th className="pb-2 font-medium">In stock</th>
                <th className="pb-2 font-medium">Held</th>
                <th className="pb-2 font-medium">Active</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id ?? `new-${i}`}>
                  <td className="py-1.5 pr-2">
                    <input
                      value={row.value}
                      onChange={(e) => update(i, { value: e.target.value })}
                      placeholder="M"
                      className={`${cellCls} uppercase`}
                      aria-label="Size"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={row.sku}
                      onChange={(e) => update(i, { sku: e.target.value })}
                      className={cellCls}
                      aria-label="SKU"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={row.priceOverride}
                      onChange={(e) => update(i, { priceOverride: e.target.value })}
                      type="number" min="0" placeholder="—"
                      className={cellCls}
                      aria-label="Price override"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={row.inventoryQty}
                      onChange={(e) => update(i, { inventoryQty: e.target.value })}
                      type="number" min="0"
                      className={cellCls}
                      aria-label="Inventory quantity"
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-center text-ink-500">
                    {row.reservedQty > 0 ? row.reservedQty : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => update(i, { isActive: e.target.checked })}
                      className="h-4 w-4 rounded border-line accent-brand-600"
                      aria-label="Active"
                    />
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      aria-label="Remove size"
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" />
          Add size
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save sizes"}
        </Button>
        {rows.some((r) => r.id) && (
          <p className="text-xs text-ink-400">
            Removing a size deactivates it — past orders keep working.
          </p>
        )}
      </div>
    </div>
  );
}
