/**
 * Hand-written row types for the tables the app reads today.
 *
 * Once a Supabase project is linked, these can be replaced by
 * `supabase gen types typescript` output. Until then these keep the data layer
 * honest without pretending to describe the whole 39-table schema.
 */

export type ProductStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type SellerStatus =
  | "DRAFT"
  | "PENDING_VERIFICATION"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "SUSPENDED"
  | "REJECTED";

export type Category = {
  id: string;
  slug: string;
  parent_id: string | null;
  name: string;
  seo_title: string | null;
  seo_description: string | null;
  intro_md: string | null;
  position: number;
  is_indexable: boolean;
};

export type Store = {
  id: string;
  seller_id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  return_policy: string | null;
  shipping_info: string | null;
  social_json: Record<string, string> | null;
  rating_avg: number;
  rating_count: number;
  product_count: number;
  is_indexable: boolean;
  created_at: string;
};

export type ProductMedia = {
  id: string;
  url: string;
  type: "image" | "video";
  position: number;
};

export type ProductOption = {
  id: string;
  name: string;
  position: number;
};

export type ProductVariant = {
  id: string;
  sku: string | null;
  option_values_json: Record<string, string>;
  price_override: number | null;
  inventory_qty: number;
  reserved_qty: number;
  is_active: boolean;
};

/** Product fields needed by a grid card. */
export type ProductListItem = {
  id: string;
  slug: string;
  name: string;
  price: number;
  compare_at_price: number | null;
  rating_avg: number;
  rating_count: number;
  store: { slug: string; name: string } | null;
  media: ProductMedia[];
};

/** Full product for a PDP. */
export type ProductDetail = ProductListItem & {
  description: string | null;
  short_description: string | null;
  category_id: string | null;
  seller_id: string;
  status: ProductStatus;
  gender: string | null;
  age_group: string | null;
  fabric: string | null;
  pattern: string | null;
  fit: string | null;
  occasion: string | null;
  wash_care: string | null;
  weight_grams: number | null;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  canonical_url: string | null;
  created_at: string;
  updated_at: string;
  options: ProductOption[];
  variants: ProductVariant[];
  storeFull: Store | null;
  category: Pick<Category, "id" | "slug" | "name" | "parent_id"> | null;
};

export type Review = {
  id: string;
  rating: number;
  body: string | null;
  verified_purchase: boolean;
  seller_response: string | null;
  created_at: string;
  customer: { full_name: string | null } | null;
};
