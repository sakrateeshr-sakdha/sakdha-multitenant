"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { submitSellerOnboarding, type OnboardingInput } from "@/lib/actions/seller";

const BUSINESS_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "proprietorship", label: "Sole proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "private_limited", label: "Private limited" },
  { value: "public_limited", label: "Public limited" },
  { value: "llp", label: "LLP" },
  { value: "not_yet_registered", label: "Not yet registered" },
] as const;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [slugEdited, setSlugEdited] = useState(false);
  const [form, setForm] = useState<OnboardingInput>({
    legalName: "",
    displayName: "",
    businessType: "proprietorship",
    contactName: defaultName,
    phone: "",
    pan: "",
    gst: "",
    storeSlug: "",
    storeName: "",
    storeDescription: "",
    street1: "",
    street2: "",
    city: "",
    state: "",
    pincode: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankIfsc: "",
  });

  const set =
    (key: keyof OnboardingInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        // Mirror the store name into the URL until the seller edits it.
        if (key === "storeName" && !slugEdited) next.storeSlug = slugify(value);
        return next;
      });
    };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await submitSellerOnboarding({
        ...form,
        pan: form.pan?.toUpperCase(),
        bankIfsc: form.bankIfsc?.toUpperCase(),
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }

      if (result.warning) toast(result.warning, { duration: 7000, icon: "⚠️" });
      else toast.success("Application submitted for review");
      router.push("/seller");
      router.refresh();
    });
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/30";

  const Field = ({
    name,
    label,
    children,
    hint,
  }: {
    name: keyof OnboardingInput;
    label: string;
    children: React.ReactNode;
    hint?: string;
  }) => (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-ink-800">
        {label}
      </label>
      {children}
      {hint && !errors[name] && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
      {errors[name] && <p className="mt-1 text-xs text-danger">{errors[name][0]}</p>}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      {/* BUSINESS */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Your business</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          This must match your PAN and bank records — Razorpay verifies it before you can be
          paid.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="legalName" label="Registered business name">
            <input id="legalName" value={form.legalName} onChange={set("legalName")} required className={inputCls} />
          </Field>
          <Field name="displayName" label="Trading name" hint="What customers call you.">
            <input id="displayName" value={form.displayName} onChange={set("displayName")} required className={inputCls} />
          </Field>
          <Field name="businessType" label="Business type">
            <select id="businessType" value={form.businessType} onChange={set("businessType")} className={inputCls}>
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field name="contactName" label="Contact person">
            <input id="contactName" value={form.contactName} onChange={set("contactName")} required className={inputCls} />
          </Field>
          <Field name="phone" label="Phone">
            <input id="phone" value={form.phone} onChange={set("phone")} required inputMode="tel" className={inputCls} />
          </Field>
          <Field name="pan" label="PAN" hint="Ten characters, e.g. ABCDE1234F.">
            <input id="pan" value={form.pan} onChange={set("pan")} className={`${inputCls} uppercase`} />
          </Field>
          <Field name="gst" label="GSTIN (optional)">
            <input id="gst" value={form.gst} onChange={set("gst")} className={`${inputCls} uppercase`} />
          </Field>
        </div>
      </section>

      {/* STORE */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Your store</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          How you appear to shoppers. The address cannot be changed later.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="storeName" label="Store name">
            <input id="storeName" value={form.storeName} onChange={set("storeName")} required className={inputCls} />
          </Field>
          <Field name="storeSlug" label="Store address">
            <div className="flex items-center gap-1 rounded-xl border border-line bg-surface px-3">
              <span className="shrink-0 text-sm text-ink-400">sakdha.com/store/</span>
              <input
                id="storeSlug"
                value={form.storeSlug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setForm((prev) => ({ ...prev, storeSlug: slugify(e.target.value) }));
                }}
                required
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </div>
            {errors.storeSlug && <p className="mt-1 text-xs text-danger">{errors.storeSlug[0]}</p>}
          </Field>
        </div>

        <div className="mt-4">
          <label htmlFor="storeDescription" className="mb-1.5 block text-sm font-medium text-ink-800">
            About your store
          </label>
          <textarea
            id="storeDescription"
            value={form.storeDescription}
            onChange={set("storeDescription")}
            rows={3}
            maxLength={600}
            className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/30"
            placeholder="Handloom saris woven in small batches in Coimbatore…"
          />
        </div>
      </section>

      {/* ADDRESS */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Registered address</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field name="street1" label="Address">
              <input id="street1" value={form.street1} onChange={set("street1")} required className={inputCls} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field name="street2" label="Address line 2 (optional)">
              <input id="street2" value={form.street2} onChange={set("street2")} className={inputCls} />
            </Field>
          </div>
          <Field name="city" label="City">
            <input id="city" value={form.city} onChange={set("city")} required className={inputCls} />
          </Field>
          <Field name="state" label="State">
            <input id="state" value={form.state} onChange={set("state")} required className={inputCls} />
          </Field>
          <Field name="pincode" label="Pincode">
            <input id="pincode" value={form.pincode} onChange={set("pincode")} required inputMode="numeric" className={inputCls} />
          </Field>
        </div>
      </section>

      {/* BANK */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink-900">Settlement account</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          Where your share of each sale is deposited. Stored encrypted; only the last four
          digits are ever shown back to you.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="bankAccountName" label="Account holder name">
            <input id="bankAccountName" value={form.bankAccountName} onChange={set("bankAccountName")} required className={inputCls} />
          </Field>
          <Field name="bankAccountNumber" label="Account number">
            <input id="bankAccountNumber" value={form.bankAccountNumber} onChange={set("bankAccountNumber")} required inputMode="numeric" autoComplete="off" className={inputCls} />
          </Field>
          <Field name="bankIfsc" label="IFSC" hint="e.g. HDFC0001234">
            <input id="bankIfsc" value={form.bankIfsc} onChange={set("bankIfsc")} required className={`${inputCls} uppercase`} />
          </Field>
        </div>
      </section>

      <div className="border-t border-line pt-6">
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Submitting…" : "Submit application"}
        </Button>
        <p className="mt-3 text-xs text-ink-400">
          By submitting you agree to Sakdha&apos;s seller terms and the 2% commission on
          product value.
        </p>
      </div>
    </form>
  );
}
