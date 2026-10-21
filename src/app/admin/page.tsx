import Link from "next/link";
import type { Metadata } from "next";
import { Store, Users, Wallet, TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Admin — Sakdha",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The panel's front door. There wasn't one — /admin 404'd and the two existing
 * pages were reachable only by typing their URLs.
 *
 * It answers "is anything waiting for me?" rather than showing analytics: the
 * counts that matter to an admin are the queues, so each tile is a count plus
 * the one link that clears it.
 */
export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();

  // `head: true` fetches counts without rows — these tiles never show records.
  const counted = (q: { count: number | null }) => q.count ?? 0;

  const [stores, liveStores, draftStores, ownerless, sellers, pendingSellers, products] =
    await Promise.all([
      supabase.from("stores").select("id", { count: "exact", head: true }),
      supabase.from("stores").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
      supabase.from("stores").select("id", { count: "exact", head: true }).eq("status", "DRAFT"),
      supabase
        .from("stores")
        .select("id", { count: "exact", head: true })
        .is("owner_profile_id", null),
      supabase.from("sellers").select("id", { count: "exact", head: true }),
      supabase
        .from("sellers")
        .select("id", { count: "exact", head: true })
        .in("status", ["PENDING_APPROVAL", "PENDING_VERIFICATION"]),
      supabase.from("products").select("id", { count: "exact", head: true }),
    ]);

  const tiles = [
    {
      icon: Store,
      label: "Stores",
      value: counted(stores),
      detail: `${counted(liveStores)} live · ${counted(draftStores)} draft`,
      href: "/admin/stores",
      cta: "Manage stores",
    },
    {
      icon: Users,
      label: "Sellers",
      value: counted(sellers),
      detail:
        counted(pendingSellers) > 0
          ? `${counted(pendingSellers)} awaiting review`
          : "none awaiting review",
      href: "/admin/sellers",
      cta: "Review sellers",
      urgent: counted(pendingSellers) > 0,
    },
    {
      icon: Wallet,
      label: "Finance",
      value: counted(products),
      detail: "products across all stores",
      href: "/admin/finance",
      cta: "Settlements",
      valueLabel: "Catalogue",
    },
  ];

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink-900">Overview</h1>
      <p className="mt-2 text-sm text-ink-500">Platform state and anything waiting on you.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand-600/40"
          >
            <div className="flex items-center gap-2 text-ink-400">
              <tile.icon className="h-4 w-4" aria-hidden />
              <span className="text-xs uppercase tracking-wide">
                {tile.valueLabel ?? tile.label}
              </span>
            </div>
            <p className="mt-3 font-display text-3xl font-semibold text-ink-900">{tile.value}</p>
            <p className={`mt-1 text-xs ${tile.urgent ? "text-amber-700" : "text-ink-500"}`}>
              {tile.detail}
            </p>
            <p className="mt-4 text-sm text-brand-600 group-hover:underline">{tile.cta} →</p>
          </Link>
        ))}
      </div>

      {/* Surfaced rather than buried: 0012 made owner_profile_id the answer to
          "whose store is this", so a store without one cannot be administered
          by its own team at all. */}
      {counted(ownerless) > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
          <div className="text-sm text-amber-900">
            <p className="font-medium">
              {counted(ownerless)} {counted(ownerless) === 1 ? "store has" : "stores have"} no
              owner.
            </p>
            <p className="mt-1 text-amber-800">
              Nobody on that store&apos;s team can sign in to manage it. This usually means the
              ownership backfill missed a row.{" "}
              <Link href="/admin/stores" className="underline">
                Review stores
              </Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
