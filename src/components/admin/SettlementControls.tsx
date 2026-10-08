"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { markSettlementPaid, runSettlement } from "@/lib/actions/settlement";

export function RunSettlementButton({ period, disabled }: { period: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending || disabled}
      title={disabled ? "This period has not finished yet." : undefined}
      onClick={() =>
        startTransition(async () => {
          const result = await runSettlement(period);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(
            `Settled ${result.count} seller${result.count === 1 ? "" : "s"}` +
              (result.skipped ? ` · ${result.skipped} already paid` : "")
          );
          router.refresh();
        })
      }
    >
      <Play className="h-4 w-4" />
      {pending ? "Running…" : "Run settlement"}
    </Button>
  );
}

export function MarkPaidButton({ settlementId }: { settlementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Mark paid
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await markSettlementPaid({ settlementId, reference });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Recorded as paid");
          setOpen(false);
          router.refresh();
        });
      }}
      className="flex items-center gap-2"
    >
      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Transfer reference"
        aria-label="Transfer reference"
        className="h-9 w-44 rounded-lg border border-line bg-surface px-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/30"
      />
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Confirm"}
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-ink-500 hover:text-ink-800"
      >
        Cancel
      </button>
    </form>
  );
}
