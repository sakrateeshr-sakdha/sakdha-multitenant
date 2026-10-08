import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Banknote, Info, TrendingUp } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getSellerEarnings,
  getSellerOrderEarnings,
  getSellerSettlements,
} from "@/lib/db/finance";
import { periodOf, previousPeriods } from "@/lib/commerce/settlement";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Earnings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ period?: string }> };

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthLabel = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

export default async function SellerFinancePage({ searchParams }: Props) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: seller } = await supabase
    .from("sellers")
    .select("id, razorpay_account_id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (!seller) redirect("/seller/onboarding");

  const sp = await searchParams;
  const now = new Date();
  const period = sp.period && PERIOD.test(sp.period) ? sp.period : periodOf(now);
  const isCurrent = period === periodOf(now);

  const [earnings, settlements, orders] = await Promise.all([
    getSellerEarnings(period),
    getSellerSettlements(),
    getSellerOrderEarnings(period),
  ]);

  const settlementForPeriod = settlements.find((s) => s.period === period);
  const months = previousPeriods(6, now);
  const noPayoutAccount = !(seller as { razorpay_account_id: string | null }).razorpay_account_id;

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink-900">Earnings</h1>
            <p className="mt-1 text-sm text-ink-500">
              {monthLabel(period)}
              {isCurrent && " — month to date"}
            </p>
          </div>
          <Link href="/seller" className="text-sm text-brand-600 hover:underline">
            Back to dashboard
          </Link>
        </div>

        {/* PERIOD PICKER */}
        <nav className="mt-6 flex flex-wrap gap-2">
          {months.map((m) => (
            <Link
              key={m}
              href={`/seller/finance?period=${m}`}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                m === period
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line bg-surface text-ink-600 hover:border-brand-300"
              }`}
            >
              {monthLabel(m)}
            </Link>
          ))}
        </nav>

        {/* SUMMARY */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: TrendingUp, label: "Gross sales", value: formatINR(earnings?.gross ?? 0), hint: "goods + shipping you charged" },
            { icon: Info, label: "Sakdha commission", value: `−${formatINR(earnings?.commission ?? 0)}`, hint: "2% of product value" },
            { icon: Info, label: "Refunds", value: earnings?.refunds ? `−${formatINR(earnings.refunds)}` : "—", hint: "charged back this period" },
            { icon: Banknote, label: "You earned", value: formatINR(earnings?.netPayable ?? 0), hint: `${earnings?.orderCount ?? 0} paid orders` },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-line bg-surface p-5">
              <kpi.icon className="h-4 w-4 text-ink-400" />
              <p className="mt-3 text-2xl font-semibold text-ink-900">{kpi.value}</p>
              <p className="mt-0.5 text-xs font-medium text-ink-700">{kpi.label}</p>
              <p className="mt-0.5 text-xs text-ink-400">{kpi.hint}</p>
            </div>
          ))}
        </div>

        {isCurrent && (
          <p className="mt-4 text-xs text-ink-400">
            This month is still running. It is settled after the month closes.
          </p>
        )}

        {noPayoutAccount && (
          <div className="mt-6 rounded-2xl border border-warning/40 bg-amber-50 p-4 text-sm text-amber-800">
            <strong className="font-semibold">No payout account connected.</strong> Your
            earnings are recorded and owed to you, but nothing can be transferred until a
            payout account is set up.
          </div>
        )}

        {/* SETTLEMENT FOR THIS PERIOD */}
        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">Settlement</h2>
          {settlementForPeriod ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-900">{monthLabel(settlementForPeriod.period)}</span>
                  <Badge tone={settlementForPeriod.status === "paid" ? "success" : "warning"}>
                    {settlementForPeriod.status}
                  </Badge>
                </div>
                {settlementForPeriod.razorpay_settlement_id && (
                  <p className="mt-1 font-mono text-xs text-ink-500">
                    ref {settlementForPeriod.razorpay_settlement_id}
                  </p>
                )}
              </div>
              <span className="text-xl font-semibold text-ink-900">
                {formatINR(settlementForPeriod.net_payable)}
              </span>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-6 text-sm text-ink-400">
              {isCurrent
                ? "This month has not been settled yet — it closes at the end of the month."
                : "No settlement has been generated for this period yet."}
            </p>
          )}
        </section>

        {/* PER-ORDER STATEMENT */}
        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">
            Orders in this period
          </h2>
          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-ink-400">
              No paid orders in {monthLabel(period)}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Order</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 text-right font-medium">Goods</th>
                    <th className="px-5 py-3 text-right font-medium">Shipping</th>
                    <th className="px-5 py-3 text-right font-medium">Commission</th>
                    <th className="px-5 py-3 text-right font-medium">You earn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-5 py-3">
                        <Link
                          href={`/seller/orders/${order.id}`}
                          className="font-medium text-ink-900 hover:text-brand-600"
                        >
                          {order.orders?.order_number}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-ink-500">
                        {new Date(order.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td className="px-5 py-3 text-right text-ink-700">{formatINR(order.subtotal)}</td>
                      <td className="px-5 py-3 text-right text-ink-700">{formatINR(order.shipping)}</td>
                      <td className="px-5 py-3 text-right text-danger">−{formatINR(order.commission)}</td>
                      <td className="px-5 py-3 text-right font-medium text-ink-900">
                        {formatINR(order.seller_payable)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* HISTORY */}
        {settlements.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">
              Settlement history
            </h2>
            <ul className="space-y-2">
              {settlements.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-sm"
                >
                  <span className="font-medium text-ink-900">{monthLabel(s.period)}</span>
                  <div className="flex items-center gap-4">
                    <Badge tone={s.status === "paid" ? "success" : "warning"}>{s.status}</Badge>
                    <span className="font-semibold text-ink-900">{formatINR(s.net_payable)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
