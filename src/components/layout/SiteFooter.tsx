import Link from "next/link";

const GATED = ["/account", "/cart", "/checkout", "/wishlist", "/seller", "/admin"];

const cols = [
  {
    title: "Shop",
    links: [
      ["Sarees", "/category/sarees"],
      ["Kurtis", "/category/kurtis"],
      ["Dresses", "/category/dresses"],
      ["All Stores", "/stores"],
    ],
  },
  {
    title: "Sell on Sakdha",
    links: [
      ["Start selling", "/sell"],
      ["Seller dashboard", "/seller"],
      ["Pricing — 2% per sale", "/sell#pricing"],
    ],
  },
  {
    title: "Help",
    links: [
      // Orders live on the account page itself. Returns get their own route in
      // P4 — until then, linking to it would be a 404 in the footer of every
      // page on the site.
      ["Your orders", "/account"],
      ["Wishlist", "/wishlist"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="container-content grid grid-cols-2 gap-8 py-14 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <div className="font-display text-2xl font-semibold text-ink-900">Sakdha</div>
          <p className="mt-3 max-w-xs text-sm text-ink-500">
            Discover fashion from stores across India. One cart, one payment, delivered
            from independent fashion stores.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="text-sm font-semibold text-ink-800">{c.title}</h4>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    // Gated destinations must not be prefetched: the auth gate
                    // records where the visitor was headed, and a prefetch
                    // would overwrite the link they actually clicked.
                    prefetch={GATED.some((g) => href.startsWith(g)) ? false : undefined}
                    className="text-sm text-ink-500 hover:text-brand-600"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-content flex h-14 items-center justify-between text-xs text-ink-400">
          <span>© {new Date().getFullYear()} Sakdha. All rights reserved.</span>
          <span>Made in India</span>
        </div>
      </div>
    </footer>
  );
}
