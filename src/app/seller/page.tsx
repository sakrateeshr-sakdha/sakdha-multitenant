import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Clock, Package, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Seller dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string; body: string }> = {
  DRAFT: { tone: "neutral", label: "Draft", body: "Finish your application to go live." },
  PENDING_VERIFICATION: {
    tone: "warning",
    label: "Verifying",
    body: "We are verifying your business details. Nothing is needed from you right now.",
  },
  PENDING_APPROVAL: {
    tone: "warning",
    label: "Awaiting approval",
    body: "Your payout account is set up. An admin is reviewing your application.",
  },
  ACTIVE: { tone: "success", label: "Live", body: "Your store is live and can receive orders." },
  SUSPENDED: {
    tone: "danger",
    label: "Suspended",
    body: "Your store is not accepting orders. Contact support.",
  },
  REJECTED: {
    tone: "danger",
    label: "Rejected",
    body: "Your application was not approved. Contact support for details.",
  },
};

export default async function SellerDashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS limits sellers to their own row, so this is the caller's seller or null.
  const { data: sellerRow } = await supabase
    .from("sellers")
    .select("id, legal_name, display_name, status, razorpay_account_id, onboarding_step")
    .maybeSingle();
  if (!sellerRow) redirect("/seller/onboarding");

  const seller = sellerRow as {
    id: string;
    legal_name: string;
    display_name: string | null;
    status: string;
    razorpay_account_id: string | null;
  };

  const [{ data: storeRow }, { data: sellerOrders }, { data: productCount }] = await Promise.all([
    supabase.from("stores").select("slug, name, product_count, is_indexable").eq("seller_id", seller.id).maybeSingle(),
    supabase
      .from("seller_orders")
      .select(
        "id, status, subtotal, shipping, commission, seller_payable, dispatch_deadline, created_at, orders:order_id ( order_number, payment_status )"
      )
      .eq("seller_id", seller.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("seller_id", seller.id),
  ]);

  const store = storeRow as { slug: string; name: string; product_count: number } | null;
  const orders = (sellerOrders ?? []) as unknown as {
    id: string;
    status: string;
    subtotal: number;
    shipping: number;
    commission: number;
    seller_payable: number;
    dispatch_deadline: string | null;
    created_at: string;
    orders: { order_number: string; payment_status: string } | null;
  }[];

  // Only paid orders represent real money.
  const paidOrders = orders.filter((o) => o.orders?.payment_status === "PAID");
  const earned = paidOrders.reduce((sum, o) => sum + o.seller_payable, 0);
  const commissionPaid = paidOrders.reduce((sum, o) => sum + o.commission, 0);

  const blockers: string[] = [];
  if (!seller.razorpay_account_id) blockers.push("Your payout account is not set up yet.");
  if (seller.status !== "ACTIVE") blockers.push("Your application has not been approved yet.");
  if (store && store.product_count === 0) blockers.push("You have not published any products.");

  // Approval alone does not make a store sellable — without a payout account
  // checkout still refuses it. Saying "Live" here while the panel below says
  // "cannot receive orders" is a contradiction the seller has to resolve.
  const payoutMissing = seller.status === "ACTIVE" && !seller.razorpay_account_id;
  const status = payoutMissing
    ? {
        tone: "warning" as const,
        label: "Approved — payouts pending",
        body: "Your application is approved, but your store cannot receive orders until a payout account is connected.",
      }
    : (STATUS_COPY[seller.status] ?? STATUS_COPY.DRAFT);

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink-900">
              {seller.display_name || seller.legal_name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Badge tone={status.tone}>{status.label}</Badge>
              {store && (
                <Link href={`/store/${store.slug}`} className="text-sm text-brand-600 hover:underline">
                  View your storefront
                </Link>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button href="/seller/orders">Fulfil orders</Button>
            <Button href="/seller/finance" variant="outline">Earnings</Button>
            <Button href="/seller/products" variant="outline">Products</Button>
            <Button href="/seller/products/new" variant="outline">
              New product
            </Button>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-sm text-ink-500">{status.body}</p>

        {blockers.length > 0 && (
          <div className="mt-6 rounded-2xl border border-warning/40 bg-amber-50 p-5">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              Before you can receive orders
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-amber-800">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex gap-2">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {blocker}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* KPIs — paid orders only, so the numbers mean something. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Package, label: "Paid orders", value: String(paidOrders.length) },
            { icon: Wallet, label: "Earned (your share)", value: formatINR(earned) },
            { icon: CheckCircle2, label: "Commission paid", value: formatINR(commissionPaid) },
            { icon: Package, label: "Products", value: String(productCount ?? store?.product_count ?? 0) },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-line bg-surface p-5">
              <kpi.icon className="h-4 w-4 text-ink-400" />
              <p className="mt-3 text-2xl font-semibold text-ink-900">{kpi.value}</p>
              <p className="mt-0.5 text-xs text-ink-500">{kpi.label}</p>
            </div>
          ))}
        </div>

        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">Recent orders</h2>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
              No orders yet. They appear here the moment a customer pays.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Order</th>
                    <th className="px-5 py-3 font-medium">Placed</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Dispatch by</th>
                    <th className="px-5 py-3 text-right font-medium">Your share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orders.map((order) => {
                    const overdue =
                      order.dispatch_deadline &&
                      new Date(order.dispatch_deadline) < new Date() &&
                      !["SHIPPED", "DELIVERED", "CANCELLED"].includes(order.status);
                    return (
                      <tr key={order.id}>
                        <td className="px-5 py-3 font-medium text-ink-900">
                          {order.orders?.order_number ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-ink-500">
                          {new Date(order.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={order.status === "CANCELLED" ? "danger" : "neutral"}>
                            {order.status.replace(/_/g, " ").toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          {order.dispatch_deadline ? (
                            <span className={overdue ? "font-medium text-danger" : "text-ink-500"}>
                              {new Date(order.dispatch_deadline).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}
                              {overdue && " · overdue"}
                            </span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-ink-900">
                          {formatINR(order.seller_payable)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-10 rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-ink-900">How you get paid</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">
            Sakdha takes 2% of product value — shipping you charge is never commissioned.
            Your share is split at the moment the customer pays and settled to your bank by
            Razorpay Route.
          </p>
          {!seller.razorpay_account_id && (
            <p className="mt-3 text-sm font-medium text-warning">
              Your payout account is not connected yet, so your store cannot receive orders.
            </p>
          )}
          <div className="mt-5">
            <Button href="/sell" variant="outline" size="sm">
              Seller handbook
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
