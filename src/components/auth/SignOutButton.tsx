"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await createClient().auth.signOut();
        router.push("/");
        // Clear the cached Server Component tree so nothing personal lingers.
        router.refresh();
      }}
    >
      <LogOut className="h-4 w-4" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
