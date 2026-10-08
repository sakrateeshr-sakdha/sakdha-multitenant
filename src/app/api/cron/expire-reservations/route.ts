import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Releases stock held by orders that were never paid for.
 *
 * Without this, an abandoned checkout holds inventory forever and the item
 * looks sold out to everyone else. Schedule on Vercel Cron every 10 minutes.
 *
 * Protected by CRON_SECRET: this moves inventory, so it must not be callable
 * by anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("expire_stale_reservations", {
    p_older_than: "30 minutes",
  });

  if (error) {
    console.error("expire_stale_reservations failed:", error);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expiredOrders: data ?? 0 });
}
