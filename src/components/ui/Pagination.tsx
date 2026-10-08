import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Crawlable pagination: every page is a real <a href> with the full query
 * string preserved, so Google can walk a category without executing JS.
 */
export function Pagination({
  page,
  pageCount,
  basePath,
  searchParams,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (pageCount <= 1) return null;

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (key === "page" || value == null) continue;
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.set(key, value);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Window of pages around the current one, always including first and last.
  const window = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const pages = [...window].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const linkCls =
    "grid h-10 min-w-10 place-items-center rounded-xl border border-line px-3 text-sm text-ink-700 hover:bg-ink-100";

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-2">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} rel="prev" aria-label="Previous page" className={linkCls}>
          <ChevronLeft className="h-4 w-4" />
        </Link>
      )}

      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && p - pages[i - 1] > 1 && <span className="text-ink-400">…</span>}
          {p === page ? (
            <span
              aria-current="page"
              className="grid h-10 min-w-10 place-items-center rounded-xl bg-ink-900 px-3 text-sm font-medium text-surface"
            >
              {p}
            </span>
          ) : (
            <Link href={hrefFor(p)} className={linkCls}>
              {p}
            </Link>
          )}
        </span>
      ))}

      {page < pageCount && (
        <Link href={hrefFor(page + 1)} rel="next" aria-label="Next page" className={linkCls}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </nav>
  );
}
