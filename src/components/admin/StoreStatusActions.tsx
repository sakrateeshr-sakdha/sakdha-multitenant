"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { setStoreStatus, type StoreStatus } from "@/lib/actions/stores";

const DONE: Record<StoreStatus, string> = {
  DRAFT: "Store moved back to draft",
  ACTIVE: "Store activated — its storefront is public",
  SUSPENDED: "Store suspended — its storefront is now dark",
  CLOSED: "Store closed",
};

export function StoreStatusActions({
  storeId,
  storeName,
  status,
  productCount,
}: {
  storeId: string;
  storeName: string;
  status: StoreStatus;
  productCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const act = (next: StoreStatus) => {
    // Taking a live store dark pulls its whole catalogue with it, so the two
    // destructive transitions ask first. Activating is freely reversible.
    if (next === "SUSPENDED" || next === "CLOSED") {
      const verb = next === "CLOSED" ? "Close" : "Suspend";
      let consequence = "";
      if (status === "ACTIVE") {
        // Naming the catalogue size is the point of the warning, so an empty
        // store should not claim "all 0 of its products".
        const catalogue =
          productCount === 1
            ? " and its 1 product"
            : productCount > 1
              ? ` and all ${productCount} of its products`
              : "";
        consequence = `\n\n${storeName} is live. Its storefront${catalogue} will stop being publicly visible.`;
      }
      if (!window.confirm(`${verb} ${storeName}?${consequence}`)) return;
    }

    startTransition(async () => {
      const result = await setStoreStatus(storeId, next);
      if (result.ok) {
        toast.success(DONE[next]);
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not update the store");
      }
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "ACTIVE" && status !== "CLOSED" && (
        <Button
          size="sm"
          onClick={() => act("ACTIVE")}
          disabled={pending}
          title={
            productCount === 0
              ? "This store has no products yet — it will stay out of the directory until it has some."
              : undefined
          }
        >
          Activate
        </Button>
      )}

      {status === "ACTIVE" && (
        <Button size="sm" variant="outline" onClick={() => act("SUSPENDED")} disabled={pending}>
          Suspend
        </Button>
      )}

      {status === "SUSPENDED" && (
        <Button size="sm" variant="outline" onClick={() => act("DRAFT")} disabled={pending}>
          Back to draft
        </Button>
      )}

      {/* A closed store is reopened as a draft, never straight to public. */}
      {status === "CLOSED" ? (
        <Button size="sm" variant="outline" onClick={() => act("DRAFT")} disabled={pending}>
          Reopen as draft
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => act("CLOSED")} disabled={pending}>
          Close
        </Button>
      )}
    </div>
  );
}
