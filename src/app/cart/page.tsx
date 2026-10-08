import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Package, ShoppingBag, Truck } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Button } from "@/components/ui/Button";
import { CartLineRow } from "@/components/marketplace/CartLineRow";
import { createServerSupabase } from "@/lib/supabase/server";
import { quoteCart } from "@/lib/commerce/quote";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Your bag",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { cart, quote } = await quoteCart();
  const blocked = cart.lines.filter((l) => !l.isAvailable);

  if (cart.lines.length === 0) {
    return (
      <>
        <SiteHeader />
        <main className="container-content py-20 text-center">
          <ShoppingBag className="mx-auto h-10 w-10 text-ink-300" />
          <h1 className="mt-4 font-display text-2xl font-semibold text-ink-900">
            Your bag is empty
          </h1>
          <p className="mt-2 text-ink-500">
            Browse stores across India and add what you love.
          </p>
          <div className="mt-7">
            <Button href="/stores" size="lg">
              Explore stores
            </Button>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // Lines are grouped by seller because that is how they will actually ship.
  const groups = quote.sellers;

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900">Your bag</h1>
        <p className="mt-2 text-sm text-ink-500">
          {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
          {quote.shipmentCount > 1 && (
            <>
              {" "}
              from {quote.shipmentCount} stores — they arrive as{" "}
              <strong className="font-medium text-ink-700">
                {quote.shipmentCount} separate packages
              </strong>
              .
            </>
          )}
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            {groups.map((group) => {
              const lines = cart.lines.filter(
                (l) => l.isAvailable && l.sellerId === group.sellerId
              );
              return (
                <section
                  key={group.sellerId}
                  className="overflow-hidden rounded-2xl border border-line bg-surface"
                >
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-5 py-3">
                    <Link
                      href={`/store/${group.storeSlug}`}
                      className="inline-flex items-center gap-2 font-medium text-ink-900 hover:text-brand-600"
                    >
                      <Package className="h-4 w-4 text-ink-400" />
                      {group.storeName}
                    </Link>
                    <span className="text-xs text-ink-500">
                      Dispatched within {group.dispatchSlaHours}h
                    </span>
                  </header>

                  <div className="divide-y divide-line px-5">
                    {lines.map((line) => (
                      <CartLineRow key={line.id} line={line} />
                    ))}
                  </div>

                  <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-ink-500">
                      <Truck className="h-4 w-4" />
                      {group.shipping === 0 ? (
                        <span className="font-medium text-success">Free shipping</span>
                      ) : (
                        <>Shipping {formatINR(group.shipping)}</>
                      )}
                    </span>
                    {group.freeShippingShortfall != null && (
                      <span className="text-xs text-ink-500">
                        Add {formatINR(group.freeShippingShortfall)} more for free shipping
                      </span>
                    )}
                    <span className="text-ink-700">
                      Store subtotal{" "}
                      <strong className="font-semibold text-ink-900">
                        {formatINR(group.subtotal + group.shipping)}
                      </strong>
                    </span>
                  </footer>
                </section>
              );
            })}

            {blocked.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-danger/30 bg-surface">
                <header className="border-b border-line bg-red-50 px-5 py-3 text-sm font-medium text-red-700">
                  Not available — these won&apos;t be charged
                </header>
                <div className="divide-y divide-line px-5">
                  {blocked.map((line) => (
                    <CartLineRow key={line.id} line={line} />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* SUMMARY */}
          <aside className="h-fit rounded-2xl border border-line bg-surface p-6 lg:sticky lg:top-24">
            <h2 className="font-display text-lg font-semibold text-ink-900">Summary</h2>

            <dl className="mt-5 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="text-ink-900">{formatINR(quote.subtotal)}</dd>
              </div>
              {quote.discountTotal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-500">Discount</dt>
                  <dd className="text-success">−{formatINR(quote.discountTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-500">
                  Shipping
                  {quote.shipmentCount > 1 && (
                    <span className="text-ink-400"> ({quote.shipmentCount} stores)</span>
                  )}
                </dt>
                <dd className="text-ink-900">
                  {quote.shippingTotal === 0 ? "Free" : formatINR(quote.shippingTotal)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-3 text-base">
                <dt className="font-medium text-ink-900">Total</dt>
                <dd className="font-semibold text-ink-900">{formatINR(quote.grandTotal)}</dd>
              </div>
            </dl>

            <div className="mt-6">
              {quote.sellers.length === 0 ? (
                <p className="rounded-xl bg-surface-2 p-3 text-center text-sm text-ink-500">
                  Nothing in your bag is currently available.
                </p>
              ) : (
                <Button href="/checkout" size="lg" className="w-full">
                  Checkout
                </Button>
              )}
            </div>

            <p className="mt-4 text-xs text-ink-400">
              One payment. Each store ships your items separately and you can track every
              package.
            </p>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
