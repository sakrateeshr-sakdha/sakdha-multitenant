import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// There is a stray package-lock.json in the user's home directory, which makes
// Next infer C:\Users\<user> as the workspace root and pull the whole home
// directory into file tracing. Pin the root to this project.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseWss = supabaseUrl.replace(/^https:/, "wss:");
// Derive the Supabase storage host for next/image remotePatterns.
let supabaseHost = "";
try {
  supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : "";
} catch {
  supabaseHost = "";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  turbopack: { root: projectRoot },

  experimental: {
    // Product photos are uploaded through a Server Action. The default 1MB
    // body limit would reject most real camera images; the action itself caps
    // individual files at 5MB.
    serverActions: { bodySizeLimit: "6mb" },
  },

  images: {
    remotePatterns: [
      // Supabase Storage public buckets (product / store media).
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
        : []),
    ],
  },

  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com",
      `connect-src 'self' ${supabaseUrl} ${supabaseWss} https://*.razorpay.com https://lumberjack.razorpay.com`,
      "img-src 'self' data: blob: https://*.razorpay.com https://*.supabase.co",
      "frame-src 'self' https://*.razorpay.com https://api.razorpay.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
    ].join("; ") + ";";

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
