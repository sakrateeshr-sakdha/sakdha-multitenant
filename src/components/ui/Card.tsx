export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
