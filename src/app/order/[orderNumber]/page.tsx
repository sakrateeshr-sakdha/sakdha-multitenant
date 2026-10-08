import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Clock, Package, Truck } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orderNumber: string }> };

type SellerOrderRow = {
  id: string;
  status: string;
  subtotal: number;
  shipping: number;
  dispatch_deadline: string | null;
  stores: { name: string; slug: string } | null;
  order_items: {
    id: string;
    name_snapshot: string;
    qty: number;
    unit_price: number;
    line_total: number;
  }[];
  shipments: {
    carrier: string | null;
    tracking_number: string | null;
    status: string;
    shipped_at: string | null;
    delivered_at: string | null;
    estimated_delivery_from: string | null;
    estimated_delivery_to: string | null;
  }[];
};

const PAYMENT_TONE = {
  PAID: "success",
  PENDING_PAYMENT: "warning",
  FAILED: "danger",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
} as const;

export default async function OrderPage({ params }: Props) {
  const { orderNumber } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // RLS restricts orders to the owning customer (and the sellers involved), so
  // a guessed order number cannot leak someone else's purchase.
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id, order_number, subtotal, shipping_total, discount_total, grand_total,
      payment_status, order_status, shipping_address_json, created_at,
      seller_orders (
        id, status, subtotal, shipping, dispatch_deadline,
        stores:store_id ( name, slug ),
        order_items ( id, name_snapshot, qty, unit_price, line_total ),
        shipments ( carrier, tracking_number, status, shipped_at, delivered_at,
                    estimated_delivery_from, estimated_delivery_to )
      )
    `
    )
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (error || !data) notFound();

  const order = data as unknown as {
    order_number: string;
    subtotal: number;
    shipping_total: number;
    discount_total: number;
    grand_total: number;
    payment_status: keyof typeof PAYMENT_TONE;
    order_status: string;
    shipping_address_json: Record<string, string>;
    created_at: string;
    seller_orders: SellerOrderRow[];
  };

  const paid = order.payment_status === "PAID";
  const address = order.shipping_address_json ?? {};
  const packages = order.seller_orders ?? [];

  return (
    <>
      <SiteHeader />
      <main className="container-content max-w-4xl pb-16 pt-10">
        <div className="text-center">
          {paid ? (
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          ) : (
            <Clock className="mx-auto h-12 w-12 text-warning" />
          )}
          <h1 className="mt-4 font-display text-3xl font-semibold text-ink-900">
            {paid ? "Order confirmed" : "Awaiting payment"}
          </h1>
          <p className="mt-2 text-ink-500">
            Order <span className="font-medium text-ink-800">{order.order_number}</span>
            {" · "}
            {new Date(order.created_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
          <div className="mt-3">
            <Badge tone={PAYMENT_TONE[order.payment_status] ?? "neutral"}>
              {order.payment_status.replace(/_/g, " ").toLowerCase()}
            </Badge>
          </div>
          {paid && packages.length > 1 && (
            <p className="mt-4 text-sm text-ink-600">
              Your items ship from {packages.length} stores and arrive as{" "}
              <strong className="font-medium">{packages.length} separate packages</strong>.
            </p>
          )}
        </div>

        <div className="mt-10 space-y-5">
          {packages.map((pkg, i) => (
            <section key={pkg.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-5 py-3">
                <span className="inline-flex items-center gap-2 font-medium text-ink-900">
                  <Package className="h-4 w-4 text-ink-400" />
                  Package {i + 1} of {packages.length}
                  {pkg.stores && (
                    <Link
                      href={`/store/${pkg.stores.slug}`}
                      className="font-normal text-ink-500 hover:text-brand-600"
                    >
                      · {pkg.stores.name}
                    </Link>
                  )}
                </span>
                <Badge tone="neutral">{pkg.status.replace(/_/g, " ").toLowerCase()}</Badge>
              </header>

              <ul className="divide-y divide-line px-5">
                {pkg.order_items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
                    <span className="text-ink-800">
                      {item.name_snapshot}
                      <span className="text-ink-400"> × {item.qty}</span>
                    </span>
                    <span className="shrink-0 text-ink-900">{formatINR(item.line_total)}</span>
                  </li>
                ))}
              </ul>

              {/* Once a parcel is handed over, tracking replaces the SLA promise. */}
              {pkg.shipments?.[0] ? (
                <div className="border-t border-line bg-surface-2 px-5 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink-800">
                      <Truck className="h-3.5 w-3.5" />
                      {pkg.shipments[0].carrier}
                    </span>
                    <span className="font-mono text-ink-700">
                      {pkg.shipments[0].tracking_number}
                    </span>
                    {pkg.shipments[0].delivered_at ? (
                      <span className="text-success">
                        Delivered{" "}
                        {new Date(pkg.shipments[0].delivered_at).toLocaleDateString("en-IN", {
                          day: "numeric", month: "short",
                        })}
                      </span>
                    ) : pkg.shipments[0].estimated_delivery_from ? (
                      <span className="text-ink-500">
                        Expected{" "}
                        {new Date(pkg.shipments[0].estimated_delivery_from).toLocaleDateString("en-IN", {
                          day: "numeric", month: "short",
                        })}
                        {pkg.shipments[0].estimated_delivery_to &&
                          `–${new Date(pkg.shipments[0].estimated_delivery_to).toLocaleDateString("en-IN", {
                            day: "numeric", month: "short",
                          })}`}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5" />
                    {pkg.shipping === 0 ? "Free shipping" : `Shipping ${formatINR(pkg.shipping)}`}
                  </span>
                  {pkg.dispatch_deadline && pkg.status !== "DELIVERED" && (
                    <span>
                      Dispatch by{" "}
                      {new Date(pkg.dispatch_deadline).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </footer>
              )}
            </section>
          ))}
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Delivery address</h2>
            <address className="text-sm not-italic leading-relaxed text-ink-600">
              {address.name}
              <br />
              {address.line1}
              {address.line2 && (
                <>
                  <br />
                  {address.line2}
                </>
              )}
              <br />
              {address.city}, {address.state} {address.pincode}
              <br />
              {address.phone}
            </address>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Payment</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="text-ink-900">{formatINR(order.subtotal)}</dd>
              </div>
              {order.discount_total > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-500">Discount</dt>
                  <dd className="text-success">−{formatINR(order.discount_total)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-500">Shipping</dt>
                <dd className="text-ink-900">
                  {order.shipping_total === 0 ? "Free" : formatINR(order.shipping_total)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-base">
                <dt className="font-medium text-ink-900">Total</dt>
                <dd className="font-semibold text-ink-900">{formatINR(order.grand_total)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-10 text-center">
          <Button href="/stores" variant="outline" size="lg">
            Continue shopping
          </Button>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
