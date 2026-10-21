import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { StoreStatusActions } from "@/components/admin/StoreStatusActions";
import { requireAdmin } from "@/lib/auth/admin";
import type { StoreStatus } from "@/lib/actions/stores";
import { storeUrl } from "@/lib/tenant/resolve";

export const metadata: Metadata = {
  title: "Stores — admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const TONE: Record<StoreStatus, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  DRAFT: "neutral",
  SUSPENDED: "warning",
  CLOSED: "danger",
};

type StoreRow = {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  product_count: number;
  is_indexable: boolean;
  city: string | null;
  published_at: string | null;
  created_at: string;
  owner_profile_id: string | null;
  profiles: { email: string | null; full_name: string | null } | null;
  store_templates: { name: string } | null;
};

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default async function AdminStoresPage() {
  const { supabase } = await requireAdmin();

  // is_admin() in the stores policy opens every row, draft ones included.
  // The two joins are the questions you actually ask of a tenant list: whose
  // store is this, and which template is it running.
  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, slug, name, status, product_count, is_indexable, city, published_at, created_at, owner_profile_id, profiles:owner_profile_id ( email, full_name ), store_templates:template_id ( name )"
    )
    .order("created_at", { ascending: false });

  // Cast through `unknown`: without generated database types, the client infers
  // every embed as an array. Both of these are to-one FK embeds and PostgREST
  // returns a single object (or null) for them — verified against the API, not
  // assumed. Treating them as arrays here would read `.email` off an object
  // that is never one.
  const stores = (data ?? []) as unknown as StoreRow[];

  const byStatus = (s: StoreStatus) => stores.filter((row) => row.status === s).length;
  const live = byStatus("ACTIVE");
  const drafts = byStatus("DRAFT");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Stores</h1>
          <p className="mt-2 text-sm text-ink-500">
            {stores.length} total · {live} live · {drafts} draft
          </p>
        </div>
      </div>

      {/* A store is only publicly readable while ACTIVE, and its products
          inherit that. Worth stating plainly, because the status column is the
          difference between a working storefront and a 404. */}
      <p className="mt-4 rounded-xl border border-line bg-ink-100/40 p-4 text-xs text-ink-600">
        Only <strong>active</strong> stores are publicly visible. Suspending or closing a store
        also hides every product it owns. Appearing in the <code>/stores</code> directory
        additionally requires at least one product.
      </p>

      {error && (
        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Could not load stores: {error.message}
        </div>
      )}

      {!error && stores.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
          No stores yet.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {stores.map((store) => {
            const owner = store.profiles;
            return (
              <article key={store.id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-ink-900">{store.name}</h2>
                      <Badge tone={TONE[store.status] ?? "neutral"}>
                        {store.status.toLowerCase()}
                      </Badge>
                      {store.status === "ACTIVE" && store.product_count === 0 && (
                        <Badge tone="warning">no products — hidden from directory</Badge>
                      )}
                      {store.status === "ACTIVE" && !store.is_indexable && (
                        <Badge tone="neutral">not indexable</Badge>
                      )}
                      {!store.owner_profile_id && <Badge tone="danger">no owner</Badge>}
                    </div>

                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-500 sm:grid-cols-2">
                      <div>
                        <dt className="inline text-ink-400">Subdomain: </dt>
                        <dd className="inline font-mono">{storeUrl(store.slug)}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-400">Owner: </dt>
                        <dd className="inline">
                          {owner?.email ?? owner?.full_name ?? "— unassigned"}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-400">Template: </dt>
                        <dd className="inline">{store.store_templates?.name ?? "none chosen"}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-400">Products: </dt>
                        <dd className="inline">{store.product_count}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-400">City: </dt>
                        <dd className="inline">{store.city ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-400">
                          {store.published_at ? "Published: " : "Created: "}
                        </dt>
                        <dd className="inline">
                          {dateLabel(store.published_at ?? store.created_at)}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-2 text-xs">
                      <Link
                        href={`/store/${store.slug}`}
                        className="text-brand-600 hover:underline"
                      >
                        /store/{store.slug}
                      </Link>
                      {store.status !== "ACTIVE" && (
                        <span className="text-ink-400"> · 404s for the public while {store.status.toLowerCase()}</span>
                      )}
                    </p>
                  </div>

                  <StoreStatusActions
                    storeId={store.id}
                    storeName={store.name}
                    status={store.status}
                    productCount={store.product_count}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
