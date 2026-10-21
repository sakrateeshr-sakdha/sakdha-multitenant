import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The admin gate, in one place.
 *
 * Every admin page needs the same two-step check, and it was previously copied
 * into each one. The duplication mattered: the two halves must stay in step —
 * a signed-out visitor gets sent to sign in, but a signed-in NON-admin gets a
 * 404 rather than a 403, because the panel's existence is not public. Getting
 * that backwards on one page would advertise the whole thing.
 *
 * This is a redirect for humans, not the authorization boundary — RLS is that,
 * and `is_admin()` is what actually opens the rows these pages read. Called per
 * page rather than from the layout on purpose: a Next.js layout does not re-run
 * on every client-side navigation, so it cannot be relied on to gate.
 */
export async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if ((profile as { role?: string } | null)?.role !== "admin") notFound();

  return { supabase, user };
}

/**
 * The same check for server actions, which must not redirect or 404 — they
 * return a failure the client can show instead.
 */
export async function assertAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if ((profile as { role?: string } | null)?.role !== "admin") {
    return { ok: false, error: "Admins only." };
  }

  return { ok: true, userId: user.id };
}
