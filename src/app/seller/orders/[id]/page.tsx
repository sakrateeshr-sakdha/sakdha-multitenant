import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ChevronLeft, MapPin, Truck } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { FulfilmentPanel } from "@/components/seller/FulfilmentPanel";
import { createServerSupabase } from "@/lib/supabase/server";
import { nextStatuses, STATUS_LABEL } from "@/lib/commerce/orderStatus";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "brand"> = {
  NEW: "brand",
  ACCEPTED: "warning",
  PROCESSING: "warning",
  READY_TO_SHIP: "warning",
  SHIPPED: "neutral",
  OUT_FOR_DELIVERY: "neutral",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default async function SellerOrderPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (!seller) redirect("/seller/onboarding");

  const { data } = await supabase
    .from("seller_orders")
    .select(
      `id, seller_id, status, subtotal, shipping, commission, seller_payable, dispatch_deadline, created_at,
       orders:order_id ( order_number, payment_status, shipping_address_json, created_at ),
       order_items ( id, name_snapshot, sku_snapshot, qty, unit_price, line_total ),
       shipments ( id, carrier, tracking_number, status, shipped_at, delivered_at, estimated_delivery_from, estimated_delivery_to )`
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const order = data as unknown as {
    id: string;
    seller_id: string;
    status: string;
    subtotal: number;
    shipping: number;
    commission: number;
    seller_payable: number;
    dispatch_deadline: string | null;
    created_at: string;
    orders: {
      order_number: string;
      payment_status: string;
      shipping_address_json: Record<string, string>;
      created_at: string;
    } | null;
    order_items: {
      id: string;
      name_snapshot: string;
      sku_snapshot: string | null;
      qty: number;
      unit_price: number;
      line_total: number;
    }[];
    shipments: {
      id: string;
      carrier: string | null;
      tracking_number: string | null;
      status: string;
      shipped_at: string | null;
      delivered_at: string | null;
      estimated_delivery_from: string | null;
      estimated_delivery_to: string | null;
    }[];
  };

  // RLS lets the buying customer read this row too — only the owning seller
  // may manage it.
  if (order.seller_id !== (seller as { id: string }).id) notFound();

  const address = order.orders?.shipping_address_json ?? {};
  const shipment = order.shipments?.[0];
  const overdue =
    order.dispatch_deadline &&
    new Date(order.dispatch_deadline).getTime() < Date.now() &&
    ["NEW", "ACCEPTED", "PROCESSING", "READY_TO_SHIP"].includes(order.status);

  return (
    <>
      <SiteHeader />
      <main className="container-content max-w-3xl pb-20 pt-8">
        <Link
          href="/seller/orders"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-brand-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Orders
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl font-semibold text-ink-900">
                {order.orders?.order_number}
              </h1>
              <Badge tone={TONE[order.status] ?? "neutral"}>
                {STATUS_LABEL[order.status] ?? order.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Placed{" "}
              {new Date(order.orders?.created_at ?? order.created_at).toLocaleString("en-IN", {
                day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-ink-900">{formatINR(order.seller_payable)}</p>
            <p className="text-xs text-ink-500">your share</p>
          </div>
        </div>

        {order.dispatch_deadline && ["NEW", "ACCEPTED", "PROCESSING", "READY_TO_SHIP"].includes(order.status) && (
          <div
            className={`mt-6 flex items-start gap-3 rounded-2xl border p-4 text-sm ${
              overdue ? "border-danger/40 bg-red-50 text-red-700" : "border-line bg-surface text-ink-600"
            }`}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {overdue ? "Dispatch is overdue — " : "Dispatch by "}
              <strong className="font-medium">
                {new Date(order.dispatch_deadline).toLocaleString("en-IN", {
                  day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                })}
              </strong>
              . Late dispatch affects your seller rating.
            </p>
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-ink-900">What to pack</h2>
          <ul className="divide-y divide-line">
            {order.order_items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink-900">{item.name_snapshot}</p>
                  {item.sku_snapshot && (
                    <p className="mt-0.5 text-xs text-ink-400">SKU {item.sku_snapshot}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-ink-900">× {item.qty}</p>
                  <p className="text-xs text-ink-400">{formatINR(item.unit_price)} each</p>
                </div>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Goods</dt>
              <dd className="text-ink-900">{formatINR(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Shipping you charged</dt>
              <dd className="text-ink-900">{formatINR(order.shipping)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Sakdha commission (2%)</dt>
              <dd className="text-danger">−{formatINR(order.commission)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base">
              <dt className="font-medium text-ink-900">You receive</dt>
              <dd className="font-semibold text-ink-900">{formatINR(order.seller_payable)}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="mb-3 inline-flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <MapPin className="h-4 w-4 text-ink-400" />
            Ship to
          </h2>
          <address className="text-sm not-italic leading-relaxed text-ink-600">
            {address.name}
            <br />
            {address.line1}
            {address.line2 && (<><br />{address.line2}</>)}
            <br />
            {address.city}, {address.state} {address.pincode}
            <br />
            {address.phone}
          </address>
        </section>

        {shipment && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
            <h2 className="mb-3 inline-flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
              <Truck className="h-4 w-4 text-ink-400" />
              Shipment
            </h2>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-500">Carrier</dt>
                <dd className="text-ink-900">{shipment.carrier}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Tracking</dt>
                <dd className="font-mono text-ink-900">{shipment.tracking_number}</dd>
              </div>
              {shipment.shipped_at && (
                <div>
                  <dt className="text-ink-500">Shipped</dt>
                  <dd className="text-ink-900">
                    {new Date(shipment.shipped_at).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </dd>
                </div>
              )}
              {shipment.delivered_at && (
                <div>
                  <dt className="text-ink-500">Delivered</dt>
                  <dd className="text-ink-900">
                    {new Date(shipment.delivered_at).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-ink-900">Next step</h2>
          <FulfilmentPanel
            sellerOrderId={order.id}
            status={order.status}
            nextOptions={nextStatuses(order.status)}
            canShip={["ACCEPTED", "PROCESSING", "READY_TO_SHIP"].includes(order.status)}
            hasShipment={Boolean(shipment)}
          />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
