import Link from "next/link";
import type { Metadata } from "next";
import { BadgeIndianRupee, Clock, LineChart, Store, Truck, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Button } from "@/components/ui/Button";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sell on Sakdha — ₹0 to start, 2% per sale",
  description:
    "Open your online fashion store on Sakdha. No subscription, no listing fees — a flat 2% marketplace commission on what you sell.",
  path: "/sell",
});

const BENEFITS = [
  {
    icon: BadgeIndianRupee,
    title: "2% commission, nothing else",
    body: "No subscription, no listing fee, no payment surcharge. You keep 98% of the product value on every order.",
  },
  {
    icon: Store,
    title: "A storefront, not a stall",
    body: "Your own address at sakdha.com/store/your-name, with your logo, policies and full catalogue.",
  },
  {
    icon: Wallet,
    title: "Paid straight to your bank",
    body: "Your share is split automatically at the moment the customer pays and settled to your account by Razorpay Route.",
  },
  {
    icon: Truck,
    title: "You control shipping",
    body: "Set free, flat or free-above-threshold shipping, and your own dispatch window per order.",
  },
  {
    icon: Clock,
    title: "Dispatch on your schedule",
    body: "Pick the dispatch SLA you can honour. Customers see it up front, so expectations stay realistic.",
  },
  {
    icon: LineChart,
    title: "Know what sells",
    body: "Orders, revenue and performance in one dashboard — no spreadsheets.",
  },
];

export default async function SellPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Someone who already sells should land in their dashboard, not a pitch.
  let hasSellerAccount = false;
  if (user) {
    const { data } = await supabase
      .from("sellers")
      .select("id")
      .eq("owner_profile_id", user.id)
      .maybeSingle();
    hasSellerAccount = Boolean(data);
  }

  const ctaHref = hasSellerAccount
    ? "/seller"
    : user
      ? "/seller/onboarding"
      : "/seller/onboarding";

  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-line bg-gradient-to-b from-brand-50/60 to-surface-2">
          <div className="container-content py-16 md:py-24">
            <div className="max-w-2xl">
              <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-600">
                For fashion stores across India
              </span>
              <h1 className="font-display text-4xl font-semibold leading-tight text-ink-900 md:text-5xl">
                Sell your fashion to the whole country.
              </h1>
              <p className="mt-5 text-lg text-ink-500">
                Open a store on Sakdha for free. Keep 98% of every sale. Get paid
                automatically when the customer pays — no invoices, no chasing.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href={ctaHref} size="lg" prefetch={false}>
                  {hasSellerAccount ? "Go to your dashboard" : "Start selling"}
                </Button>
                <Button href="/stores" size="lg" variant="outline">
                  See live stores
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="container-content py-16">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title}>
                <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <benefit.icon className="h-5 w-5" />
                </div>
                <h2 className="font-medium text-ink-900">{benefit.title}</h2>
                <p className="mt-1.5 text-sm text-ink-500">{benefit.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container-content pb-16">
          <div className="rounded-3xl border border-line bg-surface p-8 md:p-10">
            <h2 className="font-display text-2xl font-semibold text-ink-900">
              What it takes to go live
            </h2>
            <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { n: 1, t: "Tell us about your business", d: "Legal name, business type, PAN and your registered address." },
                { n: 2, t: "Name your store", d: "Pick your store address and describe what you make." },
                { n: 3, t: "Add your bank account", d: "Where your settlements land. Stored encrypted, never shared." },
                { n: 4, t: "We verify and approve", d: "We set up your payout account and review your application." },
              ].map((step) => (
                <li key={step.n}>
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-sm font-medium text-surface">
                    {step.n}
                  </span>
                  <h3 className="mt-3 font-medium text-ink-900">{step.t}</h3>
                  <p className="mt-1 text-sm text-ink-500">{step.d}</p>
                </li>
              ))}
            </ol>

            <p className="mt-8 text-sm text-ink-500">
              Your store can only receive orders once your payout account is set up and your
              application is approved — so no customer can ever pay for something we cannot
              settle to you.
            </p>

            <div className="mt-7">
              <Button href={ctaHref} size="lg" prefetch={false}>
                {hasSellerAccount ? "Go to your dashboard" : "Start your application"}
              </Button>
            </div>
          </div>
        </section>

        <section className="container-content pb-20">
          <h2 className="mb-5 font-display text-xl font-semibold text-ink-900">
            Common questions
          </h2>
          <dl className="space-y-5">
            {[
              {
                q: "What does it cost?",
                a: "Nothing to open a store. Sakdha takes 2% of the product value on each sale — shipping you charge is not commissioned.",
              },
              {
                q: "When do I get paid?",
                a: "Your share is split at the moment of payment and settled to your bank by Razorpay Route, per their settlement cycle.",
              },
              {
                q: "Who handles delivery?",
                a: "You ship your own orders. You set your shipping rates and the dispatch window you can honour.",
              },
              {
                q: "Can I sell alongside my own website?",
                a: "Yes. Sakdha is a channel, not an exclusivity agreement.",
              },
            ].map((faq) => (
              <div key={faq.q} className="rounded-2xl border border-line bg-surface p-5">
                <dt className="font-medium text-ink-900">{faq.q}</dt>
                <dd className="mt-1.5 text-sm text-ink-500">{faq.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-sm text-ink-500">
            Already selling?{" "}
            <Link href="/seller" className="font-medium text-brand-600 hover:underline">
              Open your dashboard
            </Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
