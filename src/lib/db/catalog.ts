import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Category,
  ProductDetail,
  ProductListItem,
  Review,
  Store,
} from "@/lib/db/types";

/**
 * Catalog reads for the public storefront.
 *
 * Everything here runs through the request-scoped SSR client, so RLS decides
 * visibility: anon traffic sees only ACTIVE products, while a signed-in seller
 * also sees their own drafts (handy for previewing). No service-role key is
 * used for catalog reads.
 */

export const PAGE_SIZE = 24;

/** Columns a grid card needs. Keep in sync with ProductListItem. */
const CARD_COLUMNS = `
  id, slug, name, price, compare_at_price, rating_avg, rating_count,
  stores:store_id ( slug, name ),
  product_media ( id, url, type, position )
`;

type RawCard = {
  id: string;
  slug: string;
  name: string;
  price: number;
  compare_at_price: number | null;
  rating_avg: number;
  rating_count: number;
  stores: { slug: string; name: string } | null;
  product_media: { id: string; url: string; type: "image" | "video"; position: number }[] | null;
};

function toListItem(row: RawCard): ProductListItem {
  const media = (row.product_media ?? []).slice().sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    compare_at_price: row.compare_at_price,
    rating_avg: Number(row.rating_avg ?? 0),
    rating_count: row.rating_count ?? 0,
    store: row.stores,
    media,
  };
}

export type ProductSort = "newest" | "price_asc" | "price_desc" | "rating" | "discount";

export type CatalogFilters = {
  categoryIds?: string[];
  storeId?: string;
  q?: string;
  minPrice?: number; // paise
  maxPrice?: number; // paise
  gender?: string[];
  fabric?: string[];
  occasion?: string[];
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
};

export type ProductPage = {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** PostgREST rejects a range whose first row is past the end of the result. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

/** Paginated, filtered product listing — powers category, store and search. */
export async function listProducts(filters: CatalogFilters = {}): Promise<ProductPage> {
  const supabase = await createServerSupabase();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? PAGE_SIZE;
  const from = (page - 1) * pageSize;

  // Built twice when a page turns out to be out of range: once for the rows,
  // once as a HEAD count so the caller still learns the real total.
  const buildQuery = (head: boolean) => {
    let query = supabase
      .from("products")
      .select(head ? "id" : CARD_COLUMNS, { count: "exact", head })
      .eq("status", "ACTIVE");

    if (filters.categoryIds?.length) query = query.in("category_id", filters.categoryIds);
    if (filters.storeId) query = query.eq("store_id", filters.storeId);
    if (filters.minPrice != null) query = query.gte("price", filters.minPrice);
    if (filters.maxPrice != null) query = query.lte("price", filters.maxPrice);
    if (filters.gender?.length) query = query.in("gender", filters.gender);
    if (filters.fabric?.length) query = query.in("fabric", filters.fabric);
    if (filters.occasion?.length) query = query.in("occasion", filters.occasion);
    if (filters.q) {
      // pg_trgm index on products.name backs this.
      const term = filters.q.replace(/[%,()]/g, " ").trim();
      if (term) query = query.or(`name.ilike.%${term}%,short_description.ilike.%${term}%`);
    }
    return query;
  };

  let query = buildQuery(false);

  switch (filters.sort) {
    case "price_asc":
      query = query.order("price", { ascending: true });
      break;
    case "price_desc":
      query = query.order("price", { ascending: false });
      break;
    case "rating":
      query = query.order("rating_avg", { ascending: false }).order("rating_count", { ascending: false });
      break;
    case "discount":
      query = query.order("compare_at_price", { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) {
    // Asking for page 5 of a 2-page result is a normal thing for a crawler or
    // a stale link to do — report an empty page with the true total rather
    // than failing the request.
    if (error.code === RANGE_NOT_SATISFIABLE) {
      const { count: total } = await buildQuery(true);
      return {
        items: [],
        total: total ?? 0,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)),
      };
    }
    throw new Error(`listProducts: ${error.message}`);
  }

  const total = count ?? 0;
  return {
    items: ((data ?? []) as unknown as RawCard[]).map(toListItem),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Newest active products across the marketplace (homepage "Trending Now"). */
export async function getTrendingProducts(limit = 12): Promise<ProductListItem[]> {
  const { items } = await listProducts({ pageSize: limit, sort: "newest" });
  return items;
}

/**
 * Facet counts for the filter sidebar, scoped to the same category/store the
 * listing is showing. Counted in JS over a narrow projection: at catalog sizes
 * this is cheaper than four `group by` round-trips, and it keeps the filter UI
 * honest (no option that returns zero results).
 */
export async function getFacets(
  scope: Pick<CatalogFilters, "categoryIds" | "storeId" | "q">
): Promise<{ gender: FacetCount[]; fabric: FacetCount[]; occasion: FacetCount[] }> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("products")
    .select("gender, fabric, occasion")
    .eq("status", "ACTIVE")
    .limit(2000);

  if (scope.categoryIds?.length) query = query.in("category_id", scope.categoryIds);
  if (scope.storeId) query = query.eq("store_id", scope.storeId);
  if (scope.q) {
    const term = scope.q.replace(/[%,()]/g, " ").trim();
    if (term) query = query.or(`name.ilike.%${term}%,short_description.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`getFacets: ${error.message}`);

  const tally = (key: "gender" | "fabric" | "occasion"): FacetCount[] => {
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const value = row[key];
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  return { gender: tally("gender"), fabric: tally("fabric"), occasion: tally("occasion") };
}

export type FacetCount = { value: string; count: number };

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function getCategoryTree(): Promise<Category[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("position", { ascending: true });
  if (error) throw new Error(`getCategoryTree: ${error.message}`);
  return (data ?? []) as Category[];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getCategoryBySlug: ${error.message}`);
  return (data as Category) ?? null;
}

export async function getChildCategories(parentId: string): Promise<Category[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("parent_id", parentId)
    .order("position", { ascending: true });
  if (error) throw new Error(`getChildCategories: ${error.message}`);
  return (data ?? []) as Category[];
}

/**
 * A category page lists its own products plus everything in its children, so
 * /category/sarees includes cotton-sarees and silk-sarees.
 */
export async function getCategoryScopeIds(category: Category): Promise<string[]> {
  const children = await getChildCategories(category.id);
  return [category.id, ...children.map((c) => c.id)];
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export async function getStoreBySlug(slug: string): Promise<Store | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getStoreBySlug: ${error.message}`);
  return (data as Store) ?? null;
}

export type StorePage = {
  items: Store[];
  total: number;
  page: number;
  pageCount: number;
};

export async function listStores(opts: { page?: number; city?: string; q?: string; pageSize?: number } = {}): Promise<StorePage> {
  const supabase = await createServerSupabase();
  const pageSize = opts.pageSize ?? 24;
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * pageSize;

  const buildQuery = (head: boolean) => {
    let query = supabase
      .from("stores")
      .select(head ? "id" : "*", { count: "exact", head })
      .gt("product_count", 0);

    if (opts.city) query = query.ilike("city", opts.city);
    if (opts.q) query = query.ilike("name", `%${opts.q.replace(/[%,()]/g, " ").trim()}%`);
    return query;
  };

  const { data, error, count } = await buildQuery(false)
    .order("product_count", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) {
    if (error.code === RANGE_NOT_SATISFIABLE) {
      const { count: total } = await buildQuery(true);
      return {
        items: [],
        total: total ?? 0,
        page,
        pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)),
      };
    }
    throw new Error(`listStores: ${error.message}`);
  }

  const total = count ?? 0;
  return {
    items: (data ?? []) as unknown as Store[],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Distinct cities that have at least one live store (for /city/[city]/stores). */
export async function listStoreCities(): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("stores")
    .select("city")
    .gt("product_count", 0)
    .not("city", "is", null);
  if (error) throw new Error(`listStoreCities: ${error.message}`);
  const cities = new Set<string>();
  for (const row of (data ?? []) as { city: string | null }[]) {
    if (row.city) cities.add(row.city);
  }
  return [...cities].sort();
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("products")
    .select(
      `
      *,
      stores:store_id ( * ),
      categories:category_id ( id, slug, name, parent_id ),
      product_media ( id, url, type, position ),
      product_options ( id, name, position ),
      product_variants ( id, sku, option_values_json, price_override, inventory_qty, reserved_qty, is_active )
    `
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getProductBySlug: ${error.message}`);
  if (!data) return null;

  const row = data as Record<string, unknown> & {
    stores: Store | null;
    categories: ProductDetail["category"];
    product_media: ProductDetail["media"];
    product_options: ProductDetail["options"];
    product_variants: ProductDetail["variants"];
  };

  const base = toListItem({
    ...(row as unknown as RawCard),
    stores: row.stores ? { slug: row.stores.slug, name: row.stores.name } : null,
  });

  return {
    ...base,
    ...(row as unknown as Omit<ProductDetail, keyof ProductListItem | "options" | "variants" | "storeFull" | "category">),
    options: (row.product_options ?? []).slice().sort((a, b) => a.position - b.position),
    variants: (row.product_variants ?? []).filter((v) => v.is_active),
    storeFull: row.stores,
    category: row.categories,
  };
}

/** Where a renamed slug used to live — lets the PDP permanently redirect. */
export async function getRedirectForSlug(oldSlug: string): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("product_slug_redirects")
    .select("products:product_id ( slug )")
    .eq("old_slug", oldSlug)
    .maybeSingle();
  if (error) return null; // redirect map is service-role only for writes; a read miss is fine
  const target = (data as { products: { slug: string } | null } | null)?.products;
  return target?.slug ?? null;
}

export async function getApprovedReviews(productId: string, limit = 10): Promise<Review[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .select("id, rating, body, verified_purchase, seller_response, created_at, profiles:customer_id ( full_name )")
    .eq("product_id", productId)
    .eq("status", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getApprovedReviews: ${error.message}`);
  return ((data ?? []) as unknown as (Omit<Review, "customer"> & {
    profiles: { full_name: string | null } | null;
  })[]).map((r) => ({ ...r, customer: r.profiles }));
}

/** Same category, different product — falls back to the same store. */
export async function getRelatedProducts(product: ProductDetail, limit = 6): Promise<ProductListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase.from("products").select(CARD_COLUMNS).eq("status", "ACTIVE").neq("id", product.id);
  query = product.category_id
    ? query.eq("category_id", product.category_id)
    : query.eq("store_id", (product.storeFull?.id ?? ""));

  const { data, error } = await query.limit(limit);
  if (error) throw new Error(`getRelatedProducts: ${error.message}`);
  return ((data ?? []) as unknown as RawCard[]).map(toListItem);
}

/** Other products from the same store, for the PDP "More from this store" rail. */
export async function getStoreProducts(storeId: string, limit = 6, excludeId?: string): Promise<ProductListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("products")
    .select(CARD_COLUMNS)
    .eq("status", "ACTIVE")
    .eq("store_id", storeId);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`getStoreProducts: ${error.message}`);
  return ((data ?? []) as unknown as RawCard[]).map(toListItem);
}

/** Total live inventory across a product's active variants. */
export function inStock(product: ProductDetail): boolean {
  if (!product.variants.length) return true; // simple product, no variant tracking yet
  return product.variants.some((v) => v.inventory_qty - v.reserved_qty > 0);
}

export function variantPrice(product: ProductDetail, variantId?: string): number {
  const v = product.variants.find((x) => x.id === variantId);
  return v?.price_override ?? product.price;
}
