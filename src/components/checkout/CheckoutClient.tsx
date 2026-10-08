"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type AddressDraft = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
};

export function CheckoutClient({
  initialAddress,
  payableLabel,
}: {
  initialAddress: Partial<AddressDraft>;
  payableLabel: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState<AddressDraft>({
    name: initialAddress.name ?? "",
    phone: initialAddress.phone ?? "",
    line1: initialAddress.line1 ?? "",
    line2: initialAddress.line2 ?? "",
    city: initialAddress.city ?? "",
    state: initialAddress.state ?? "",
    pincode: initialAddress.pincode ?? "",
  });
  const [pending, setPending] = useState(false);

  const set = (key: keyof AddressDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((prev) => ({ ...prev, [key]: e.target.value }));

  const onPay = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);

    try {
      // 1. Server builds the order and the Route split. The browser never
      //    sends an amount — it only learns what it owes.
      const response = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await response.json();

      if (!response.ok) {
        const stores = Array.isArray(data.stores) ? ` (${data.stores.join(", ")})` : "";
        throw new Error(`${data.error ?? "Checkout failed"}${stores}`);
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        throw new Error("Could not load the payment window. Check your connection.");
      }

      // 2. Hand off to Razorpay Checkout.
      const checkout = new window.Razorpay({
        key: data.keyId,
        order_id: data.razorpayOrderId,
        amount: data.amount,
        currency: data.currency,
        name: "Sakdha",
        description: `Order ${data.orderNumber}`,
        prefill: {
          name: data.customer?.name,
          email: data.customer?.email,
          contact: data.customer?.contact,
        },
        notes: { order_number: data.orderNumber },
        theme: { color: "#c7402a" },
        modal: {
          ondismiss: () => {
            setPending(false);
            toast("Payment cancelled. Your bag is safe.", { icon: "🛍️" });
          },
        },
        handler: async (payment: RazorpayResponse) => {
          // 3. Confirm the handshake. The webhook is still the authority for
          //    inventory and the ledger; this just gets the customer a
          //    trustworthy confirmation page.
          const verifyResponse = await fetch("/api/checkout/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payment),
          });

          if (!verifyResponse.ok) {
            toast.error("We could not verify the payment. Support has been notified.");
            router.push(`/order/${data.orderNumber}`);
            return;
          }
          router.push(`/order/${data.orderNumber}`);
        },
      });

      checkout.open();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
      setPending(false);
    }
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/30";

  return (
    <form onSubmit={onPay} className="space-y-4">
      <h2 className="font-display text-lg font-semibold text-ink-900">Delivery address</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink-800">
            Full name
          </label>
          <input id="name" value={address.name} onChange={set("name")} required autoComplete="name" className={inputCls} />
        </div>
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-ink-800">
            Phone
          </label>
          <input id="phone" value={address.phone} onChange={set("phone")} required autoComplete="tel" inputMode="tel" className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="line1" className="mb-1.5 block text-sm font-medium text-ink-800">
          Address
        </label>
        <input id="line1" value={address.line1} onChange={set("line1")} required autoComplete="address-line1" className={inputCls} />
      </div>

      <div>
        <label htmlFor="line2" className="mb-1.5 block text-sm font-medium text-ink-800">
          Apartment, landmark <span className="font-normal text-ink-400">(optional)</span>
        </label>
        <input id="line2" value={address.line2} onChange={set("line2")} autoComplete="address-line2" className={inputCls} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="city" className="mb-1.5 block text-sm font-medium text-ink-800">
            City
          </label>
          <input id="city" value={address.city} onChange={set("city")} required autoComplete="address-level2" className={inputCls} />
        </div>
        <div>
          <label htmlFor="state" className="mb-1.5 block text-sm font-medium text-ink-800">
            State
          </label>
          <input id="state" value={address.state} onChange={set("state")} required autoComplete="address-level1" className={inputCls} />
        </div>
        <div>
          <label htmlFor="pincode" className="mb-1.5 block text-sm font-medium text-ink-800">
            Pincode
          </label>
          <input
            id="pincode"
            value={address.pincode}
            onChange={set("pincode")}
            required
            pattern="\d{6}"
            inputMode="numeric"
            autoComplete="postal-code"
            className={inputCls}
          />
        </div>
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        <Lock className="h-4 w-4" />
        {pending ? "Starting payment…" : `Pay ${payableLabel}`}
      </Button>

      <p className="text-center text-xs text-ink-400">
        Payments are processed by Razorpay. Sakdha never sees your card details.
      </p>
    </form>
  );
}
