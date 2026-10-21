"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin panel had no navigation at all — every page was reachable only by
 * typing its URL. Kept as a client component solely to mark the current tab.
 */
const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/stores", label: "Stores" },
  { href: "/admin/sellers", label: "Sellers" },
  { href: "/admin/finance", label: "Finance" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-line" aria-label="Admin">
      <ul className="container-content flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          // "/admin" must only win on an exact match, or it would stay lit on
          // every child route.
          const active = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm transition-colors ${
                  active
                    ? "border-brand-600 font-medium text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-800"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
