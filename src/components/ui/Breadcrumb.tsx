import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { name: string; href: string };

/** Visible breadcrumb trail. Pair with breadcrumbJsonLd() for the SEO half. */
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="py-4">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={crumb.href} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="font-medium text-ink-700">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link href={crumb.href} className="hover:text-brand-600">
                    {crumb.name}
                  </Link>
                  <ChevronRight className="h-3 w-3 text-ink-300" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
