import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ProductForm } from "@/components/seller/ProductForm";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCategoryOptions } from "@/lib/db/seller";

export const metadata: Metadata = {
  title: "New product",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
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

  const categories = await getCategoryOptions();

  return (
    <>
      <SiteHeader />
      <main className="container-content max-w-3xl pb-20 pt-8">
        <Link
          href="/seller/products"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-brand-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Products
        </Link>

        <h1 className="mt-4 font-display text-3xl font-semibold text-ink-900">New product</h1>
        <p className="mt-2 text-ink-500">
          This starts as a draft. You add photos and sizes next, then publish when it&apos;s
          ready.
        </p>

        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 md:p-8">
          <ProductForm categories={categories} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
