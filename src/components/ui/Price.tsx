import { formatINR, discountPercent } from "@/lib/money";

/** Price display with optional strikethrough compare-at and discount badge. */
export function Price({
  price,
  compareAt,
  size = "md",
}: {
  price: number;
  compareAt?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const pct = discountPercent(price, compareAt);
  const main =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <div className="flex items-baseline gap-2">
      <span className={`font-semibold text-ink-900 ${main}`}>{formatINR(price)}</span>
      {compareAt && compareAt > price && (
        <span className="text-sm text-ink-400 line-through">{formatINR(compareAt)}</span>
      )}
      {pct && <span className="text-xs font-semibold text-success">{pct}% off</span>}
    </div>
  );
}
