import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Package, Truck } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { createServerSupabase } from "@/lib/supabase/server";
import { quoteCart } from "@/lib/commerce/quote";
import { isRazorpayConfigured, isUnsplitCheckoutAllowed } from "@/lib/payments/razorpay";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { cart, quote } = await quoteCart();

  // Nothing purchasable → back to the bag, which explains why.
  if (quote.sellers.length === 0) redirect("/cart");
  if (cart.lines.some((l) => !l.isAvailable)) redirect("/cart");

  const [{ data: profile }, { data: address }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
    supabase
      .from("addresses")
      .select("name, phone, line1, line2, city, state, pincode")
      .eq("customer_id", user.id)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const saved = (address ?? {}) as Partial<{
    name: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
  }>;
  const who = (profile ?? {}) as { full_name?: string | null; phone?: string | null };

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900">Checkout</h1>

        {!isRazorpayConfigured() && (
          <div className="mt-6 rounded-2xl border border-warning/40 bg-amber-50 p-4 text-sm text-amber-800">
            <strong className="font-semibold">Payments are not configured.</strong> Add
            <code className="mx-1 rounded bg-amber-100 px-1">RAZORPAY_KEY_ID</code> and
            <code className="mx-1 rounded bg-amber-100 px-1">RAZORPAY_KEY_SECRET</code>
            to <code className="rounded bg-amber-100 px-1">.env.local</code>. You can review
            the order below, but payment will be refused.
          </div>
        )}

        {isUnsplitCheckoutAllowed() && (
          <div className="mt-6 rounded-2xl border border-danger/40 bg-red-50 p-4 text-sm text-red-700">
            <strong className="font-semibold">Test mode: payments are not split.</strong>{" "}
            Razorpay Route is not enabled, so Sakdha collects the full amount and seller
            payouts become a manual obligation. Never use this against live keys — enable
            Route and remove{" "}
            <code className="rounded bg-red-100 px-1">SAKDHA_ALLOW_UNSPLIT_CHECKOUT</code>.
          </div>
        )}

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <CheckoutClient
              initialAddress={{
                name: saved.name ?? who.full_name ?? "",
                phone: saved.phone ?? who.phone ?? "",
                line1: saved.line1 ?? "",
                line2: saved.line2 ?? "",
                city: saved.city ?? "",
                state: saved.state ?? "",
                pincode: saved.pincode ?? "",
              }}
              payableLabel={formatINR(quote.grandTotal)}
            />
          </div>

          <aside className="h-fit space-y-5 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-line bg-surface p-6">
              <h2 className="font-display text-lg font-semibold text-ink-900">Order summary</h2>

              <div className="mt-4 space-y-4">
                {quote.sellers.map((seller) => (
                  <div key={seller.sellerId} className="rounded-xl bg-surface-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900">
                        <Package className="h-4 w-4 text-ink-400" />
                        {seller.storeName}
                      </span>
                      <span className="text-sm text-ink-700">
                        {formatINR(seller.subtotal + seller.shipping)}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {seller.lines.map((line) => (
                        <li
                          key={`${line.productId}-${line.variantId ?? "base"}`}
                          className="flex justify-between gap-3 text-xs text-ink-500"
                        >
                          <span className="truncate">
                            {line.name} × {line.qty}
                          </span>
                          <span className="shrink-0">{formatINR(line.lineTotal)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-400">
                      <Truck className="h-3.5 w-3.5" />
                      {seller.shipping === 0 ? "Free shipping" : `Shipping ${formatINR(seller.shipping)}`}
                      {" · "}
                      dispatched within {seller.dispatchSlaHours}h
                    </p>
                  </div>
                ))}
              </div>

              <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-500">Subtotal</dt>
                  <dd className="text-ink-900">{formatINR(quote.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Shipping</dt>
                  <dd className="text-ink-900">
                    {quote.shippingTotal === 0 ? "Free" : formatINR(quote.shippingTotal)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-line pt-3 text-base">
                  <dt className="font-medium text-ink-900">Total payable</dt>
                  <dd className="font-semibold text-ink-900">{formatINR(quote.grandTotal)}</dd>
                </div>
              </dl>
            </div>

            {quote.shipmentCount > 1 && (
              <p className="rounded-2xl border border-line bg-surface p-4 text-xs text-ink-500">
                Your order ships as <strong className="text-ink-700">{quote.shipmentCount} separate
                packages</strong>, one per store. Each has its own tracking.
              </p>
            )}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
