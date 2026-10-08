import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { AuthForm } from "@/components/auth/AuthForm";
import { peekReturnTo } from "@/lib/auth/returnTo";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const returnTo = await peekReturnTo("/");
  // Someone who landed here on the way to opening a store should be told that
  // this is step one, not the whole thing.
  const sellerBound = returnTo.startsWith("/seller");

  return (
    <>
      <SiteHeader />
      <main className="container-content flex justify-center py-16">
        <div className="w-full max-w-sm">
          <h1 className="mb-2 font-display text-2xl font-semibold text-ink-900">
            {sellerBound ? "First, create your account" : "Create your account"}
          </h1>
          <p className="mb-7 text-sm text-ink-500">
            {sellerBound
              ? "Next you'll add your business, store and bank details."
              : "Shop across stores with one bag and one payment."}
          </p>
          <AuthForm mode="signup" returnTo={returnTo} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
