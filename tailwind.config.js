/** @type {import('tailwindcss').Config} */
const withOpacity = (v) => `rgb(var(${v}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ink: near-black text / high-contrast surfaces.
        ink: {
          50: withOpacity("--c-ink-50"),
          100: withOpacity("--c-ink-100"),
          200: withOpacity("--c-ink-200"),
          300: withOpacity("--c-ink-300"),
          400: withOpacity("--c-ink-400"),
          500: withOpacity("--c-ink-500"),
          600: withOpacity("--c-ink-600"),
          700: withOpacity("--c-ink-700"),
          800: withOpacity("--c-ink-800"),
          900: withOpacity("--c-ink-900"),
          950: withOpacity("--c-ink-950"),
        },
        // Brand: Sakdha accent (warm fashion rose/terracotta).
        brand: {
          50: withOpacity("--c-brand-50"),
          100: withOpacity("--c-brand-100"),
          200: withOpacity("--c-brand-200"),
          300: withOpacity("--c-brand-300"),
          400: withOpacity("--c-brand-400"),
          500: withOpacity("--c-brand-500"),
          600: withOpacity("--c-brand-600"),
          700: withOpacity("--c-brand-700"),
          800: withOpacity("--c-brand-800"),
          900: withOpacity("--c-brand-900"),
          950: withOpacity("--c-brand-950"),
        },
        surface: withOpacity("--c-surface"),
        "surface-2": withOpacity("--c-surface-2"),
        line: withOpacity("--c-line"),
        success: withOpacity("--c-success"),
        warning: withOpacity("--c-warning"),
        danger: withOpacity("--c-danger"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 16 20 / 0.04), 0 8px 24px -12px rgb(16 16 20 / 0.12)",
        "card-hover": "0 2px 4px rgb(16 16 20 / 0.06), 0 16px 40px -16px rgb(16 16 20 / 0.20)",
        drawer: "0 0 0 1px rgb(16 16 20 / 0.05), -24px 0 48px -24px rgb(16 16 20 / 0.30)",
      },
      maxWidth: {
        content: "1280px",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
