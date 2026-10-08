import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { OnboardingForm } from "@/components/seller/OnboardingForm";
import { createServerSupabase } from "@/lib/supabase/server";
import { isEncryptionConfigured } from "@/lib/crypto";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";

export const metadata: Metadata = {
  title: "Become a seller",
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function SellerOnboardingPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signup");

  // An existing seller belongs in the dashboard, not back through onboarding.
  const { data: existing } = await supabase
    .from("sellers")
    .select("id")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (existing) redirect("/seller");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const encryptionReady = isEncryptionConfigured();

  return (
    <>
      <SiteHeader />
      <main className="container-content max-w-3xl pb-20 pt-10">
        <h1 className="font-display text-3xl font-semibold text-ink-900">
          Open your store on Sakdha
        </h1>
        <p className="mt-2 text-ink-500">
          Four short sections. We verify your details and set up your payout account before
          your store goes live.
        </p>

        {!encryptionReady && (
          <div className="mt-6 rounded-2xl border border-danger/40 bg-red-50 p-4 text-sm text-red-700">
            <strong className="font-semibold">Applications are paused.</strong> This
            deployment has no <code className="rounded bg-red-100 px-1">ENCRYPTION_KEY</code>,
            so bank details cannot be stored safely. Generate one with{" "}
            <code className="rounded bg-red-100 px-1">
              node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
            </code>{" "}
            and add it to <code className="rounded bg-red-100 px-1">.env.local</code>.
          </div>
        )}

        {encryptionReady && !isRazorpayConfigured() && (
          <div className="mt-6 rounded-2xl border border-warning/40 bg-amber-50 p-4 text-sm text-amber-800">
            <strong className="font-semibold">Payouts are not configured.</strong> Your
            application will be saved, but the Razorpay payout account cannot be created
            until API keys are added.
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 md:p-8">
          <OnboardingForm defaultName={(profile as { full_name?: string } | null)?.full_name ?? ""} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
