"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { deleteProduct, setProductStatus } from "@/lib/actions/products";

export function ProductStatusBar({
  productId,
  status,
  hasBeenOrdered,
}: {
  productId: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  hasBeenOrdered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: "DRAFT" | "ACTIVE" | "ARCHIVED") =>
    startTransition(async () => {
      const result = await setProductStatus(productId, next);
      if (!result.ok) {
        // Publishing has real preconditions (price, photo, payable seller);
        // surfacing the exact reason beats a generic failure.
        toast.error(result.error, { duration: 6000 });
        return;
      }
      toast.success(next === "ACTIVE" ? "Published" : next === "DRAFT" ? "Unpublished" : "Archived");
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteProduct(productId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(hasBeenOrdered ? "Archived — it has past orders" : "Deleted");
      router.push("/seller/products");
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "ACTIVE" ? (
        <Button size="sm" onClick={() => change("ACTIVE")} disabled={pending}>
          <Eye className="h-4 w-4" />
          Publish
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => change("DRAFT")} disabled={pending}>
          <EyeOff className="h-4 w-4" />
          Unpublish
        </Button>
      )}

      <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
        <Trash2 className="h-4 w-4" />
        {hasBeenOrdered ? "Archive" : "Delete"}
      </Button>
    </div>
  );
}
