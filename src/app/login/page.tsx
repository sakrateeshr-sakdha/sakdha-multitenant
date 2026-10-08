import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { AuthForm } from "@/components/auth/AuthForm";
import { peekReturnTo } from "@/lib/auth/returnTo";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// Reads the return-to cookie, so it cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const returnTo = await peekReturnTo("/");

  return (
    <>
      <SiteHeader />
      <main className="container-content flex justify-center py-16">
        <div className="w-full max-w-sm">
          <h1 className="mb-2 font-display text-2xl font-semibold text-ink-900">
            Sign in to Sakdha
          </h1>
          <p className="mb-7 text-sm text-ink-500">
            Your bag, orders and saved stores live here.
          </p>
          <AuthForm mode="login" returnTo={returnTo} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
