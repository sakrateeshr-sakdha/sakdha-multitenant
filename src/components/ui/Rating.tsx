import { Star } from "lucide-react";

/** Compact star rating with count. Renders nothing when there are no ratings. */
export function Rating({ value, count }: { value: number; count?: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-600">
      <Star className="h-3.5 w-3.5 fill-brand-500 text-brand-500" />
      <span className="font-medium text-ink-800">{value.toFixed(1)}</span>
      {count != null && <span className="text-ink-400">({count})</span>}
    </span>
  );
}
