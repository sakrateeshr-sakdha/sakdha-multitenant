import Link from "next/link";
import type { Metadata } from "next";
import { Banknote, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { MarkPaidButton, RunSettlementButton } from "@/components/admin/SettlementControls";
import { requireAdmin } from "@/lib/auth/admin";
import { getPlatformPeriod, getRecordedSettlements } from "@/lib/db/finance";
import { periodOf, previousPeriods } from "@/lib/commerce/settlement";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Finance — admin",
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

export default async function AdminFinancePage({ searchParams }: Props) {
  await requireAdmin();

  const sp = await searchParams;
  const now = new Date();
  const period = sp.period && PERIOD.test(sp.period) ? sp.period : periodOf(now);
  const isCurrent = period === periodOf(now);

  const [{ settlements, position }, recorded] = await Promise.all([
    getPlatformPeriod(period),
    getRecordedSettlements(period),
  ]);

  const months = previousPeriods(6, now);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Finance</h1>
          <p className="mt-1 text-sm text-ink-500">
            {monthLabel(period)}
            {isCurrent && " — in progress"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/sellers" className="text-sm text-brand-600 hover:underline">
            Sellers
          </Link>
          <RunSettlementButton period={period} disabled={isCurrent} />
        </div>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2">
        {months.map((m) => (
          <Link
            key={m}
            href={`/admin/finance?period=${m}`}
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

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: TrendingUp, label: "Gross merchandise value", value: formatINR(position.gross) },
          { icon: Receipt, label: "Commission earned", value: formatINR(position.commission) },
          { icon: Wallet, label: "Gateway fees", value: `−${formatINR(position.gatewayFees)}` },
          { icon: Banknote, label: "Owed to sellers", value: formatINR(position.owedToSellers) },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-line bg-surface p-5">
            <kpi.icon className="h-4 w-4 text-ink-400" />
            <p className="mt-3 text-2xl font-semibold text-ink-900">{kpi.value}</p>
            <p className="mt-0.5 text-xs text-ink-500">{kpi.label}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm text-ink-500">
        Net revenue after gateway fees:{" "}
        <strong className="font-semibold text-ink-900">{formatINR(position.netRevenue)}</strong>
        {isCurrent && (
          <span className="text-ink-400"> · this month is still running and cannot be settled yet</span>
        )}
      </p>

      <section className="mt-10">
        <h2 className="mb-4 font-display text-xl font-semibold text-ink-900">
          Seller positions
        </h2>

        {settlements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-ink-400">
            No seller activity in {monthLabel(period)}.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Seller</th>
                  <th className="px-5 py-3 text-right font-medium">Gross</th>
                  <th className="px-5 py-3 text-right font-medium">Commission</th>
                  <th className="px-5 py-3 text-right font-medium">Refunds</th>
                  <th className="px-5 py-3 text-right font-medium">Net payable</th>
                  <th className="px-5 py-3 font-medium">Settlement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {settlements.map((s) => {
                  const record = recorded.get(s.sellerId);
                  // The live figure can drift from a recorded settlement if a
                  // refund landed after the run — surfacing it beats hiding it.
                  const drifted =
                    record && record.status !== "paid" && record.net_payable !== s.netPayable;
                  return (
                    <tr key={s.sellerId}>
                      <td className="px-5 py-3 font-medium text-ink-900">{s.sellerName}</td>
                      <td className="px-5 py-3 text-right text-ink-700">{formatINR(s.gross)}</td>
                      <td className="px-5 py-3 text-right text-success">{formatINR(s.commission)}</td>
                      <td className="px-5 py-3 text-right text-ink-500">
                        {s.refunds ? `−${formatINR(s.refunds)}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-ink-900">
                        {formatINR(s.netPayable)}
                      </td>
                      <td className="px-5 py-3">
                        {!record ? (
                          <span className="text-xs text-ink-400">not run</span>
                        ) : record.status === "paid" ? (
                          <Badge tone="success">paid</Badge>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <MarkPaidButton settlementId={record.id} />
                            {drifted && (
                              <span className="text-xs text-warning">
                                recorded {formatINR(record.net_payable)} — re-run
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-8 max-w-2xl text-xs text-ink-400">
        Figures are computed from the ledger, not from orders, so refunds that landed after a
        sale are always reflected. Marking a settlement paid records the payout — it does not
        move money.
      </p>
    </>
  );
}
