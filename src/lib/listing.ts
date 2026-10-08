import type { CatalogFilters, FacetCount, ProductSort } from "@/lib/db/catalog";
import type { FacetGroup } from "@/components/marketplace/FilterPanel";

export type RawSearchParams = Record<string, string | string[] | undefined>;

const SORTS: ProductSort[] = ["newest", "price_asc", "price_desc", "rating", "discount"];

function asArray(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined;
  const list = (Array.isArray(value) ? value : [value]).filter(Boolean);
  return list.length ? list : undefined;
}

function asInt(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Turns URL query params into a validated CatalogFilters. Anything unexpected
 * is dropped rather than passed to the query — the URL is user input.
 */
export function parseListingParams(params: RawSearchParams): CatalogFilters {
  const sortRaw = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const sort = SORTS.includes(sortRaw as ProductSort) ? (sortRaw as ProductSort) : "newest";
  const q = Array.isArray(params.q) ? params.q[0] : params.q;

  return {
    page: asInt(params.page) || 1,
    minPrice: asInt(params.min),
    maxPrice: asInt(params.max),
    gender: asArray(params.gender),
    fabric: asArray(params.fabric),
    occasion: asArray(params.occasion),
    sort,
    q: q?.trim() || undefined,
  };
}

/** True when the visitor has narrowed the view — such pages are not indexed. */
export function hasActiveFilters(filters: CatalogFilters): boolean {
  return Boolean(
    filters.minPrice != null ||
      filters.maxPrice != null ||
      filters.gender?.length ||
      filters.fabric?.length ||
      filters.occasion?.length
  );
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ");

export function buildFacetGroups(facets: {
  gender: FacetCount[];
  fabric: FacetCount[];
  occasion: FacetCount[];
}): FacetGroup[] {
  return [
    { key: "gender", label: "Gender", options: facets.gender.map(toOption) },
    { key: "fabric", label: "Fabric", options: facets.fabric.map(toOption) },
    { key: "occasion", label: "Occasion", options: facets.occasion.map(toOption) },
  ];
}

function toOption(f: FacetCount) {
  return { value: f.value, label: titleCase(f.value), count: f.count };
}
