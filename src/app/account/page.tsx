import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Heart, Package, Store as StoreIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAYMENT_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  PAID: "success",
  PENDING_PAYMENT: "warning",
  FAILED: "danger",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

export default async function AccountPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: orderRows }, { count: wishlistCount }, { data: seller }] =
    await Promise.all([
      supabase.from("profiles").select("full_name, email, phone, role").eq("id", user.id).maybeSingle(),
      supabase
        .from("orders")
        .select("order_number, grand_total, payment_status, order_status, created_at, seller_orders(id)")
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("wishlist_items")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", user.id),
      supabase.from("sellers").select("id").maybeSingle(),
    ]);

  const me = (profile ?? {}) as {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: string;
  };
  const orders = (orderRows ?? []) as unknown as {
    order_number: string;
    grand_total: number;
    payment_status: string;
    order_status: string;
    created_at: string;
    seller_orders: { id: string }[];
  }[];

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink-900">
              {me.full_name || "Your account"}
            </h1>
            <p className="mt-1 text-sm text-ink-500">{me.email ?? user.email}</p>
          </div>
          <SignOutButton />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Link
            href="/wishlist"
            className="rounded-2xl border border-line bg-surface p-5 transition hover:border-brand-300"
          >
            <Heart className="h-4 w-4 text-ink-400" />
            <p className="mt-3 text-2xl font-semibold text-ink-900">{wishlistCount ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink-500">Saved items</p>
          </Link>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <Package className="h-4 w-4 text-ink-400" />
            <p className="mt-3 text-2xl font-semibold text-ink-900">{orders.length}</p>
            <p className="mt-0.5 text-xs text-ink-500">Orders</p>
          </div>

          <Link
            href={seller ? "/seller" : "/sell"}
            className="rounded-2xl border border-line bg-surface p-5 transition hover:border-brand-300"
          >
            <StoreIcon className="h-4 w-4 text-ink-400" />
            <p className="mt-3 text-sm font-semibold text-ink-900">
              {seller ? "Seller dashboard" : "Start selling"}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {seller ? "Manage your store" : "₹0 to open a store"}
            </p>
          </Link>
        </div>

        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">Your orders</h2>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
              <p className="text-ink-400">You haven&apos;t placed an order yet.</p>
              <div className="mt-6">
                <Button href="/stores">Explore stores</Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {orders.map((order) => (
                <li key={order.order_number}>
                  <Link
                    href={`/order/${order.order_number}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5 transition hover:border-brand-300"
                  >
                    <div>
                      <p className="font-medium text-ink-900">{order.order_number}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {new Date(order.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        {order.seller_orders?.length > 1 &&
                          ` · ${order.seller_orders.length} packages`}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge tone={PAYMENT_TONE[order.payment_status] ?? "neutral"}>
                        {order.payment_status.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                      <span className="font-semibold text-ink-900">
                        {formatINR(order.grand_total)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
