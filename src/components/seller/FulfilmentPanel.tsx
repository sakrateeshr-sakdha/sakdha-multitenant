"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Truck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  advanceSellerOrder,
  cancelSellerOrder,
  createShipment,
} from "@/lib/actions/fulfilment";
import { STATUS_LABEL, type SellerOrderStatus } from "@/lib/commerce/orderStatus";

const CARRIERS = ["Delhivery", "Blue Dart", "DTDC", "India Post", "Ekart", "Xpressbees", "Other"];

export function FulfilmentPanel({
  sellerOrderId,
  status,
  nextOptions,
  canShip,
  hasShipment,
}: {
  sellerOrderId: string;
  status: string;
  nextOptions: SellerOrderStatus[];
  canShip: boolean;
  hasShipment: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showShip, setShowShip] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [shipment, setShipment] = useState({
    carrier: CARRIERS[0],
    trackingNumber: "",
    shippingMethod: "",
    estimatedDeliveryFrom: "",
    estimatedDeliveryTo: "",
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong");
        return;
      }
      toast.success(success);
      setShowShip(false);
      setShowCancel(false);
      router.refresh();
    });

  const inputCls =
    "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-600/30";

  // SHIPPED is reached by recording a shipment, not by a bare status change —
  // otherwise an order could be "shipped" with no tracking for the customer.
  const stepOptions = nextOptions.filter((s) => s !== "SHIPPED" && s !== "CANCELLED");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {stepOptions.map((next) => (
          <Button
            key={next}
            size="sm"
            onClick={() => run(() => advanceSellerOrder(sellerOrderId, next), `Marked ${STATUS_LABEL[next].toLowerCase()}`)}
            disabled={pending}
          >
            Mark {STATUS_LABEL[next].toLowerCase()}
          </Button>
        ))}

        {canShip && !hasShipment && (
          <Button size="sm" onClick={() => setShowShip((v) => !v)} disabled={pending}>
            <Truck className="h-4 w-4" />
            Ship this package
          </Button>
        )}

        {nextOptions.includes("CANCELLED") && (
          <Button size="sm" variant="ghost" onClick={() => setShowCancel((v) => !v)} disabled={pending}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
        )}

        {nextOptions.length === 0 && (
          <p className="text-sm text-ink-500">
            This package is {STATUS_LABEL[status]?.toLowerCase() ?? status.toLowerCase()} — nothing
            further to do.
          </p>
        )}
      </div>

      {showShip && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createShipment(sellerOrderId, shipment), "Shipment recorded");
          }}
          className="space-y-4 rounded-2xl border border-line bg-surface-2 p-5"
        >
          <h3 className="text-sm font-semibold text-ink-900">Shipment details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="carrier" className="mb-1.5 block text-sm font-medium text-ink-800">
                Carrier
              </label>
              <select
                id="carrier"
                value={shipment.carrier}
                onChange={(e) => setShipment((s) => ({ ...s, carrier: e.target.value }))}
                className={inputCls}
              >
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tracking" className="mb-1.5 block text-sm font-medium text-ink-800">
                Tracking number
              </label>
              <input
                id="tracking"
                value={shipment.trackingNumber}
                onChange={(e) => setShipment((s) => ({ ...s, trackingNumber: e.target.value }))}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="etaFrom" className="mb-1.5 block text-sm font-medium text-ink-800">
                Delivery expected from
              </label>
              <input
                id="etaFrom" type="date"
                value={shipment.estimatedDeliveryFrom}
                onChange={(e) => setShipment((s) => ({ ...s, estimatedDeliveryFrom: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="etaTo" className="mb-1.5 block text-sm font-medium text-ink-800">
                …to
              </label>
              <input
                id="etaTo" type="date"
                value={shipment.estimatedDeliveryTo}
                onChange={(e) => setShipment((s) => ({ ...s, estimatedDeliveryTo: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-xs text-ink-400">
            The customer sees the carrier, tracking number and these dates on their order page.
          </p>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Confirm shipment"}
          </Button>
        </form>
      )}

      {showCancel && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => cancelSellerOrder(sellerOrderId, reason), "Package cancelled");
          }}
          className="space-y-3 rounded-2xl border border-danger/30 bg-red-50 p-5"
        >
          <h3 className="text-sm font-semibold text-red-800">Cancel this package</h3>
          <p className="text-xs text-red-700">
            Stock goes back on the shelf. This does <strong>not</strong> refund the customer —
            issue the refund separately.
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder="Reason (shown to admin, not the customer)"
            className={inputCls}
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </form>
      )}
    </div>
  );
}
