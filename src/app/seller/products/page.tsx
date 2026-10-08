import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = {
  title: "Your products",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  ACTIVE: "success",
  DRAFT: "neutral",
  SUSPENDED: "danger",
  ARCHIVED: "neutral",
} as const;

type Row = {
  id: string;
  slug: string;
  name: string;
  price: number;
  status: keyof typeof STATUS_TONE;
  updated_at: string;
  product_media: { url: string; position: number }[] | null;
  product_variants: { inventory_qty: number; reserved_qty: number; is_active: boolean }[] | null;
};

export default async function SellerProductsPage() {
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

  // RLS lets a seller see their own non-ACTIVE products too.
  const { data } = await supabase
    .from("products")
    .select(
      "id, slug, name, price, status, updated_at, product_media(url, position), product_variants(inventory_qty, reserved_qty, is_active)"
    )
    .eq("seller_id", (seller as { id: string }).id)
    .order("updated_at", { ascending: false });

  const products = (data ?? []) as unknown as Row[];
  const live = products.filter((p) => p.status === "ACTIVE").length;
  const drafts = products.filter((p) => p.status === "DRAFT").length;

  return (
    <>
      <SiteHeader />
      <main className="container-content pb-16 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink-900">Your products</h1>
            <p className="mt-1 text-sm text-ink-500">
              {products.length} total · {live} live · {drafts} draft
            </p>
          </div>
          <Button href="/seller/products/new">
            <Plus className="h-4 w-4" />
            New product
          </Button>
        </div>

        {products.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
            <p className="text-ink-400">You haven&apos;t added any products yet.</p>
            <div className="mt-6">
              <Button href="/seller/products/new">Add your first product</Button>
            </div>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {products.map((product) => {
              const cover = (product.product_media ?? []).sort((a, b) => a.position - b.position)[0];
              const variants = (product.product_variants ?? []).filter((v) => v.is_active);
              const available = variants.reduce(
                (n, v) => n + Math.max(0, v.inventory_qty - v.reserved_qty),
                0
              );
              return (
                <li key={product.id}>
                  <Link
                    href={`/seller/products/${product.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition hover:border-brand-300"
                  >
                    <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-ink-100">
                      {cover && (
                        <Image src={cover.url} alt="" fill sizes="64px" className="object-cover" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900">{product.name}</span>
                        <Badge tone={STATUS_TONE[product.status] ?? "neutral"}>
                          {product.status.toLowerCase()}
                        </Badge>
                        {(product.product_media ?? []).length === 0 && (
                          <Badge tone="warning">no photo</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        /product/{product.slug}
                        {variants.length > 0 && ` · ${available} in stock across ${variants.length} sizes`}
                      </p>
                    </div>

                    <span className="shrink-0 font-semibold text-ink-900">
                      {formatINR(product.price)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
