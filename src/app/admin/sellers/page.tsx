import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { SellerApprovalActions } from "@/components/admin/SellerApprovalActions";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sellers — admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  PENDING_APPROVAL: "warning",
  PENDING_VERIFICATION: "warning",
  DRAFT: "neutral",
  SUSPENDED: "danger",
  REJECTED: "danger",
};

export default async function AdminSellersPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // Not an admin → 404 rather than 403: the panel's existence is not public.
  if ((profile as { role?: string } | null)?.role !== "admin") notFound();

  // is_admin() in RLS opens every seller row to this query.
  const { data } = await supabase
    .from("sellers")
    .select(
      "id, legal_name, display_name, status, razorpay_account_id, onboarding_step, created_at, kyc_json, stores ( slug, name, product_count )"
    )
    .order("created_at", { ascending: false });

  const sellers = (data ?? []) as {
    id: string;
    legal_name: string;
    display_name: string | null;
    status: string;
    razorpay_account_id: string | null;
    created_at: string;
    kyc_json: { business_type?: string; contact_name?: string; pan?: string | null } | null;
    stores: { slug: string; name: string; product_count: number }[] | null;
  }[];

  const awaiting = sellers.filter((s) =>
    ["PENDING_APPROVAL", "PENDING_VERIFICATION"].includes(s.status)
  );

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900">Sellers</h1>
        <p className="mt-2 text-sm text-ink-500">
          {sellers.length} total · {awaiting.length} awaiting review
        </p>

        {sellers.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
            No seller applications yet.
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {sellers.map((seller) => {
              const store = seller.stores?.[0];
              return (
                <article
                  key={seller.id}
                  className="rounded-2xl border border-line bg-surface p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium text-ink-900">
                          {seller.display_name || seller.legal_name}
                        </h2>
                        <Badge tone={TONE[seller.status] ?? "neutral"}>
                          {seller.status.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                        {!seller.razorpay_account_id && (
                          <Badge tone="danger">no payout account</Badge>
                        )}
                      </div>

                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-500 sm:grid-cols-2">
                        <div>
                          <dt className="inline text-ink-400">Legal name: </dt>
                          <dd className="inline">{seller.legal_name}</dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-400">Contact: </dt>
                          <dd className="inline">{seller.kyc_json?.contact_name ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-400">Type: </dt>
                          <dd className="inline">
                            {(seller.kyc_json?.business_type ?? "—").replace(/_/g, " ")}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-400">PAN: </dt>
                          <dd className="inline">{seller.kyc_json?.pan ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-400">Razorpay: </dt>
                          <dd className="inline font-mono">
                            {seller.razorpay_account_id ?? "not connected"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-400">Applied: </dt>
                          <dd className="inline">
                            {new Date(seller.created_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </dd>
                        </div>
                      </dl>

                      {store && (
                        <p className="mt-2 text-xs">
                          <Link
                            href={`/store/${store.slug}`}
                            className="text-brand-600 hover:underline"
                          >
                            /store/{store.slug}
                          </Link>
                          <span className="text-ink-400"> · {store.product_count} products</span>
                        </p>
                      )}
                    </div>

                    <SellerApprovalActions
                      sellerId={seller.id}
                      status={seller.status}
                      canApprove={Boolean(seller.razorpay_account_id)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
