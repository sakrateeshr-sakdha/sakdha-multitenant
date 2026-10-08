import { forwardRef } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "bg-ink-900 text-surface hover:bg-ink-800",
  outline: "border border-line text-ink-800 hover:bg-ink-100",
  ghost: "text-ink-700 hover:bg-ink-100",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

type CommonProps = { variant?: Variant; size?: Size; className?: string };

type ButtonProps = CommonProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AnchorProps = CommonProps & {
  href: string;
  children?: React.ReactNode;
  /**
   * Pass `false` for links into signed-in-only areas. Prefetching those hits
   * the auth gate in middleware, and the gate records where the visitor was
   * headed — so a speculative prefetch would overwrite the destination of the
   * link they actually clicked.
   */
  prefetch?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps | AnchorProps>(
  function Button(props, ref) {
    const { variant = "primary", size = "md", className = "", ...rest } = props as ButtonProps;
    const cls = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

    if ("href" in props && props.href) {
      const { href, children, prefetch } = props as AnchorProps;
      return (
        <Link href={href} prefetch={prefetch} className={cls}>
          {children}
        </Link>
      );
    }
    return <button ref={ref} className={cls} {...rest} />;
  }
);
