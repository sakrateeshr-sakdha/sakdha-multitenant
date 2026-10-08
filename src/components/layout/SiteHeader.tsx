import Link from "next/link";
import { Search, Heart, ShoppingBag, User } from "lucide-react";

const nav = [
  { label: "Sarees", href: "/category/sarees" },
  { label: "Kurtis", href: "/category/kurtis" },
  { label: "Dresses", href: "/category/dresses" },
  { label: "Men", href: "/category/mens-shirts" },
  { label: "Kids", href: "/category/kids-wear" },
  { label: "Stores", href: "/stores" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
      <div className="container-content flex h-16 items-center gap-4">
        <Link href="/" className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          Sakdha
        </Link>

        <nav className="ml-6 hidden items-center gap-6 lg:flex">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-sm font-medium text-ink-600 transition hover:text-brand-600"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        {/* A plain GET form: search works with JavaScript disabled, and the
            result page is a real shareable URL. */}
        <form
          action="/search"
          method="get"
          role="search"
          className="ml-auto hidden max-w-sm flex-1 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 md:flex"
        >
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            type="search"
            name="q"
            aria-label="Search products and stores"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-ink-400"
            placeholder="Search products, stores…"
          />
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Link href="/wishlist" prefetch={false} aria-label="Wishlist" className="grid h-10 w-10 place-items-center rounded-xl text-ink-600 hover:bg-ink-100">
            <Heart className="h-5 w-5" />
          </Link>
          <Link href="/account" prefetch={false} aria-label="Account" className="grid h-10 w-10 place-items-center rounded-xl text-ink-600 hover:bg-ink-100">
            <User className="h-5 w-5" />
          </Link>
          <Link href="/cart" prefetch={false} aria-label="Cart" className="grid h-10 w-10 place-items-center rounded-xl text-ink-600 hover:bg-ink-100">
            <ShoppingBag className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
