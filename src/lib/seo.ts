import type { Metadata } from "next";
import type { Category, ProductDetail, Store } from "@/lib/db/types";

export const SITE_NAME = "Sakdha";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sakdha.com";

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

type MetaInput = {
  title: string;
  description: string;
  path: string;
  images?: string[];
  noindex?: boolean;
  keywords?: string | null;
};

/**
 * The root layout appends "| Sakdha" via its title template. Titles that come
 * from the database (categories.seo_title, products.seo_title) are written by
 * admins and sellers who often include the brand themselves, which would
 * render "… | Sakdha | Sakdha". Strip a trailing brand suffix so the template
 * is the single source of branding.
 */
export function stripBrandSuffix(title: string): string {
  return title.replace(/\s*[|–—-]\s*Sakdha\s*$/i, "").trim();
}

/** One place that builds title/description/canonical/OG/Twitter consistently. */
export function buildMetadata({
  title: rawTitle,
  description,
  path,
  images,
  noindex,
  keywords,
}: MetaInput): Metadata {
  const url = absoluteUrl(path);
  const title = stripBrandSuffix(rawTitle);
  return {
    title,
    description,
    keywords: keywords || undefined,
    alternates: { canonical: url },
    robots: noindex
      ? { index: false, follow: true }
      : { index: true, follow: true, googleBot: { index: true, follow: true } },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url,
      images: images?.length ? images : undefined,
    },
    twitter: {
      card: images?.length ? "summary_large_image" : "summary",
      title,
      description,
      images: images?.length ? images : undefined,
    },
  };
}

export function productMetadata(product: ProductDetail): Metadata {
  const storeName = product.store?.name;
  const title =
    product.seo_title ||
    [product.name, storeName && `by ${storeName}`].filter(Boolean).join(" ");
  const description =
    product.seo_description ||
    product.short_description ||
    (product.description ? product.description.slice(0, 160) : "") ||
    `Buy ${product.name}${storeName ? ` from ${storeName}` : ""} on Sakdha.`;

  return buildMetadata({
    title,
    description,
    path: `/product/${product.slug}`,
    images: product.media.filter((m) => m.type === "image").map((m) => m.url).slice(0, 4),
    keywords: product.seo_keywords,
    // A product that is not ACTIVE must never be indexed.
    noindex: product.status !== "ACTIVE",
  });
}

export function storeMetadata(store: Store): Metadata {
  const where = store.city ? ` in ${store.city}` : "";
  return buildMetadata({
    title: `${store.name} — Fashion Store${where}`,
    description:
      store.description?.slice(0, 160) ||
      `Shop ${store.name}${where} on Sakdha. ${store.product_count} products available.`,
    path: `/store/${store.slug}`,
    images: [store.cover_url, store.logo_url].filter(Boolean) as string[],
    // Thin / empty stores stay out of the index (spec §51 guardrail).
    noindex: !store.is_indexable || store.product_count === 0,
  });
}

export function categoryMetadata(
  category: Category,
  opts: { productCount: number; page?: number; parent?: Category | null }
): Metadata {
  const page = opts.page ?? 1;
  const pageSuffix = page > 1 ? ` — Page ${page}` : "";
  const path = opts.parent
    ? `/category/${opts.parent.slug}/${category.slug}`
    : `/category/${category.slug}`;

  // Strip the brand BEFORE appending " — Page n": otherwise the suffix sits
  // after "| Sakdha" and stripBrandSuffix's trailing match no longer applies.
  const baseTitle = stripBrandSuffix(category.seo_title || `${category.name} Online`);

  return buildMetadata({
    title: baseTitle + pageSuffix,
    description:
      category.seo_description ||
      `Shop ${category.name.toLowerCase()} from fashion stores across India on Sakdha.`,
    path: page > 1 ? `${path}?page=${page}` : path,
    // No products → nothing worth indexing.
    noindex: !category.is_indexable || opts.productCount === 0,
  });
}

// ---------------------------------------------------------------------------
// JSON-LD builders (spec §20-21). Ratings are emitted ONLY when real reviews
// exist — never fabricate aggregateRating.
// ---------------------------------------------------------------------------

export function productJsonLd(product: ProductDetail, availability: boolean) {
  const images = product.media.filter((m) => m.type === "image").map((m) => m.url);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.short_description || product.description || undefined,
    image: images.length ? images : undefined,
    sku: product.variants[0]?.sku || undefined,
    category: product.category?.name,
    color: undefined,
    material: product.fabric || undefined,
    pattern: product.pattern || undefined,
    audience: product.gender
      ? { "@type": "PeopleAudience", suggestedGender: product.gender }
      : undefined,
    brand: product.store?.name
      ? { "@type": "Brand", name: product.store.name }
      : undefined,
    offers: {
      "@type": "Offer",
      url: absoluteUrl(`/product/${product.slug}`),
      priceCurrency: "INR",
      price: (product.price / 100).toFixed(2),
      availability: availability
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: product.store?.name
        ? { "@type": "Organization", name: product.store.name }
        : undefined,
    },
    aggregateRating:
      product.rating_count > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: Number(product.rating_avg).toFixed(1),
            reviewCount: product.rating_count,
          }
        : undefined,
  };
}

export function storeJsonLd(store: Store) {
  const hasAddress = Boolean(store.city || store.state || store.pincode);
  return {
    "@context": "https://schema.org",
    "@type": hasAddress ? "LocalBusiness" : "Organization",
    name: store.name,
    description: store.description || undefined,
    url: absoluteUrl(`/store/${store.slug}`),
    image: store.cover_url || store.logo_url || undefined,
    logo: store.logo_url || undefined,
    address: hasAddress
      ? {
          "@type": "PostalAddress",
          addressLocality: store.city || undefined,
          addressRegion: store.state || undefined,
          postalCode: store.pincode || undefined,
          addressCountry: "IN",
        }
      : undefined,
    aggregateRating:
      store.rating_count > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: Number(store.rating_avg).toFixed(1),
            reviewCount: store.rating_count,
          }
        : undefined,
  };
}

export function breadcrumbJsonLd(trail: { name: string; href: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.href),
    })),
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "Sakdha is a fashion marketplace where independent stores across India sell directly to shoppers.",
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}
