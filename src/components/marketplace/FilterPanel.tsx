"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type FacetGroup = {
  /** Query-string key, e.g. "gender". */
  key: string;
  label: string;
  options: { value: string; label: string; count?: number }[];
};

export type PriceBand = { label: string; min?: number; max?: number };

/** Price bands in paise. Coarse on purpose — fewer crawlable permutations. */
export const PRICE_BANDS: PriceBand[] = [
  { label: "Under ₹500", max: 50_000 },
  { label: "₹500 – ₹1,000", min: 50_000, max: 100_000 },
  { label: "₹1,000 – ₹2,500", min: 100_000, max: 250_000 },
  { label: "₹2,500 – ₹5,000", min: 250_000, max: 500_000 },
  { label: "Above ₹5,000", min: 500_000 },
];

export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Top rated" },
  { value: "discount", label: "Biggest discount" },
] as const;

/**
 * Filters write to the URL, so a filtered view is shareable and the server
 * re-queries under RLS. Filter params are disallowed in robots.txt to keep
 * crawl budget on clean category URLs.
 */
export function FilterPanel({ facets }: { facets: FacetGroup[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const apply = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page"); // any filter change resets to page 1
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const toggleMulti = (key: string, value: string) =>
    apply((params) => {
      const current = params.getAll(key);
      params.delete(key);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      next.forEach((v) => params.append(key, v));
    });

  const setBand = (band: PriceBand, active: boolean) =>
    apply((params) => {
      params.delete("min");
      params.delete("max");
      if (active) return; // clicking the active band clears it
      if (band.min != null) params.set("min", String(band.min));
      if (band.max != null) params.set("max", String(band.max));
    });

  const activeMin = searchParams.get("min");
  const activeMax = searchParams.get("max");
  const activeCount =
    facets.reduce((n, f) => n + searchParams.getAll(f.key).length, 0) +
    (activeMin || activeMax ? 1 : 0);

  const body = (
    <div className="space-y-7">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Price</h3>
        <ul className="space-y-2">
          {PRICE_BANDS.map((band) => {
            const active =
              String(band.min ?? "") === (activeMin ?? "") &&
              String(band.max ?? "") === (activeMax ?? "");
            return (
              <li key={band.label}>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => setBand(band, active)}
                    className="h-4 w-4 rounded border-line accent-brand-600"
                  />
                  {band.label}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {facets
        .filter((f) => f.options.length > 0)
        .map((facet) => {
          const selected = searchParams.getAll(facet.key);
          return (
            <section key={facet.key}>
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{facet.label}</h3>
              <ul className="space-y-2">
                {facet.options.map((opt) => (
                  <li key={opt.value}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
                      <input
                        type="checkbox"
                        checked={selected.includes(opt.value)}
                        onChange={() => toggleMulti(facet.key, opt.value)}
                        className="h-4 w-4 rounded border-line accent-brand-600"
                      />
                      <span className="capitalize">{opt.label}</span>
                      {opt.count != null && (
                        <span className="text-xs text-ink-400">({opt.count})</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

      {activeCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            apply((params) => {
              facets.forEach((f) => params.delete(f.key));
              params.delete("min");
              params.delete("max");
            })
          }
        >
          Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile trigger */}
      <div className="mb-4 lg:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" />
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 lg:block">{body}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 right-0 w-80 max-w-[85vw] animate-slide-up overflow-y-auto bg-surface p-5 shadow-drawer">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Filters</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className="grid h-9 w-9 place-items-center rounded-xl text-ink-600 hover:bg-ink-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {body}
          </div>
        </div>
      )}
    </>
  );
}

/** Sort control — also URL-driven so the server does the ordering. */
export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("sort") ?? "newest";

  return (
    <label className="flex items-center gap-2 text-sm text-ink-500">
      Sort
      <select
        value={current}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          if (e.target.value === "newest") params.delete("sort");
          else params.set("sort", e.target.value);
          params.delete("page");
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }}
        className="h-9 rounded-xl border border-line bg-surface px-2 text-sm text-ink-800 outline-none focus:ring-2 focus:ring-brand-600/30"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
