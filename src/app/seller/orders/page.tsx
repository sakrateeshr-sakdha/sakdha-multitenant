import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Package } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { createServerSupabase } from "@/lib/supabase/server";
import { STATUS_LABEL } from "@/lib/commerce/orderStatus";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Orders to fulfil",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

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

/** Open orders first, then newest — what a seller needs to act on. */
const OPEN = ["NEW", "ACCEPTED", "PROCESSING", "READY_TO_SHIP"];

type Row = {
  id: string;
  status: string;
  seller_payable: number;
  dispatch_deadline: string | null;
  created_at: string;
  orders: { order_number: string; payment_status: string } | null;
  order_items: { name_snapshot: string; qty: number }[];
};

export default async function SellerOrdersPage() {
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
      "id, status, seller_payable, dispatch_deadline, created_at, orders:order_id(order_number, payment_status), order_items(name_snapshot, qty)"
    )
    .eq("seller_id", (seller as { id: string }).id)
    .order("created_at", { ascending: false });

  // Unpaid orders are not the seller's problem — they never see them.
  const all = ((data ?? []) as unknown as Row[]).filter(
    (o) => o.orders?.payment_status === "PAID"
  );
  const open = all.filter((o) => OPEN.includes(o.status));
  const done = all.filter((o) => !OPEN.includes(o.status));
  const now = Date.now();
  const overdue = open.filter(
    (o) => o.dispatch_deadline && new Date(o.dispatch_deadline).getTime() < now
  );

  const renderRow = (order: Row) => {
    const isOverdue =
      order.dispatch_deadline &&
      new Date(order.dispatch_deadline).getTime() < now &&
      OPEN.includes(order.status);
    const units = order.order_items.reduce((n, i) => n + i.qty, 0);

    return (
      <li key={order.id}>
        <Link
          href={`/seller/orders/${order.id}`}
          className={`flex flex-wrap items-center gap-4 rounded-2xl border bg-surface p-4 transition hover:border-brand-300 ${
            isOverdue ? "border-danger/40" : "border-line"
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-900">
                {order.orders?.order_number ?? "—"}
              </span>
              <Badge tone={TONE[order.status] ?? "neutral"}>
                {STATUS_LABEL[order.status] ?? order.status}
              </Badge>
              {isOverdue && (
                <Badge tone="danger">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  overdue
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-ink-500">
              {units} {units === 1 ? "item" : "items"} ·{" "}
              {order.order_items.map((i) => i.name_snapshot).join(", ")}
            </p>
          </div>

          <div className="text-right">
            <p className="font-semibold text-ink-900">{formatINR(order.seller_payable)}</p>
            {order.dispatch_deadline && OPEN.includes(order.status) && (
              <p className={`text-xs ${isOverdue ? "font-medium text-danger" : "text-ink-500"}`}>
                dispatch by{" "}
                {new Date(order.dispatch_deadline).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })}
              </p>
            )}
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900">Orders</h1>
        <p className="mt-1 text-sm text-ink-500">
          {open.length} to fulfil · {done.length} completed
          {overdue.length > 0 && (
            <span className="font-medium text-danger"> · {overdue.length} overdue</span>
          )}
        </p>

        {all.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-ink-400">
            <Package className="mx-auto h-8 w-8 text-ink-300" />
            <p className="mt-3">No paid orders yet. They appear here the moment a customer pays.</p>
          </div>
        ) : (
          <>
            {open.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
                  Needs action
                </h2>
                <ul className="space-y-3">{open.map(renderRow)}</ul>
              </section>
            )}

            {done.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
                  Completed
                </h2>
                <ul className="space-y-3">{done.map(renderRow)}</ul>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
