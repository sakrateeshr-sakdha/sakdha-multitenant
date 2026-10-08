import type { Metadata } from "next";
import { Outfit, Fraunces } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sakdha.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Sakdha — Discover Fashion Stores. Shop Everything You Love.",
    template: "%s | Sakdha",
  },
  description:
    "Discover fashion from stores across India in one marketplace. One cart, one payment, delivered from independent fashion stores.",
  openGraph: {
    type: "website",
    siteName: "Sakdha",
    title: "Sakdha — Discover Fashion Stores",
    description: "Discover fashion from stores across India in one marketplace.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "rgb(24 24 29)",
              color: "#fff",
              borderRadius: "12px",
              fontSize: "14px",
            },
          }}
        />
      </body>
    </html>
  );
}
