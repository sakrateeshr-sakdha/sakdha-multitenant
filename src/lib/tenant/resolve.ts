/**
 * Which store is this request for?
 *
 * Sakdha serves two different products from one deployment:
 *
 *   sakdha.com            the platform — marketing, signup, seller dashboard
 *   storename.sakdha.com  one tenant's storefront
 *   fashionstore.com      the same tenant on their own domain
 *
 * Everything downstream keys off this answer, so it is deliberately pure and
 * synchronous where it can be: host parsing has no I/O, and only a custom
 * domain needs a database lookup.
 */

export type Tenant =
  | { kind: "platform" }
  /** Resolved from a subdomain label; the slug still has to exist. */
  | { kind: "store"; by: "subdomain"; slug: string }
  /** Resolved from a custom domain; needs a store_domains lookup. */
  | { kind: "store"; by: "domain"; domain: string };

/** Hostnames that are the platform itself, never a store. */
const PLATFORM_LABELS = new Set(["www", "app", "admin", "api", "dashboard"]);

/**
 * The apex the platform runs on, e.g. "sakdha.com". In development this is
 * "localhost", which makes `storename.localhost:3100` work in every modern
 * browser without touching the hosts file.
 */
export function rootDomain(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").toLowerCase();
}

/** Strips the port and lowercases. Host headers may or may not carry a port. */
function normaliseHost(host: string): string {
  return host.toLowerCase().split(":")[0].trim();
}

export function resolveTenantFromHost(hostHeader: string | null | undefined): Tenant {
  if (!hostHeader) return { kind: "platform" };

  const host = normaliseHost(hostHeader);
  const root = rootDomain();

  // Vercel preview URLs and bare IPs are the platform, never a tenant.
  if (host.endsWith(".vercel.app") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { kind: "platform" };
  }

  if (host === root) return { kind: "platform" };

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    // Only a single label is a store: "a.b.sakdha.com" is not a tenant.
    if (!label || label.includes(".")) return { kind: "platform" };
    if (PLATFORM_LABELS.has(label)) return { kind: "platform" };
    return { kind: "store", by: "subdomain", slug: label };
  }

  // Anything else is somebody's own domain pointed at us.
  return { kind: "store", by: "domain", domain: host };
}

/** Slug rules for a subdomain label, applied before any database lookup. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (slug.length > 50) return "Use 50 characters or fewer.";
  if (!SLUG_PATTERN.test(slug)) {
    return "Use lowercase letters, numbers and hyphens. It can't start or end with a hyphen.";
  }
  if (slug.includes("--")) return "Avoid double hyphens.";
  return null;
}

/** The public address of a store, for display and for "copy link". */
export function storeUrl(slug: string, opts?: { protocol?: string; port?: string }): string {
  const root = rootDomain();
  const protocol = opts?.protocol ?? (root === "localhost" ? "http" : "https");
  const port = opts?.port ? `:${opts.port}` : "";
  return `${protocol}://${slug}.${root}${port}`;
}
