"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { setSellerStatus } from "@/lib/actions/seller";

export function SellerApprovalActions({
  sellerId,
  status,
  canApprove,
}: {
  sellerId: string;
  status: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const act = (next: "ACTIVE" | "REJECTED" | "SUSPENDED") =>
    startTransition(async () => {
      const result = await setSellerStatus(sellerId, next);
      if (result.ok) {
        toast.success(`Seller ${next.toLowerCase()}`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not update the seller");
      }
    });

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "ACTIVE" && (
        <Button
          size="sm"
          onClick={() => act("ACTIVE")}
          disabled={pending || !canApprove}
          // Approving a seller with no linked account would break every cart
          // they appear in, so the button is disabled rather than failing late.
          title={canApprove ? undefined : "No Razorpay linked account — this seller cannot be paid."}
        >
          Approve
        </Button>
      )}
      {status === "ACTIVE" && (
        <Button size="sm" variant="outline" onClick={() => act("SUSPENDED")} disabled={pending}>
          Suspend
        </Button>
      )}
      {status !== "REJECTED" && (
        <Button size="sm" variant="ghost" onClick={() => act("REJECTED")} disabled={pending}>
          Reject
        </Button>
      )}
    </div>
  );
}
