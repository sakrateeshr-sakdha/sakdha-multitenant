import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { AdminNav } from "@/components/admin/AdminNav";

/**
 * Chrome shared by every admin page: the site header, the panel's own tab bar,
 * and the footer. Each page used to render the header and footer itself.
 *
 * Note what is NOT here: the admin check. A layout does not re-run on every
 * client-side navigation, so gating here would be a hole. Each page calls
 * `requireAdmin()` for itself.
 */
export const metadata: Metadata = {
  title: "Admin — Sakdha",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <AdminNav />
      <main className="container-content pb-16 pt-8">{children}</main>
      <SiteFooter />
    </>
  );
}
