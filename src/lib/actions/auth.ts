"use server";

import { cookies } from "next/headers";
import { RETURN_TO_COOKIE, RETURN_TO_MAX_AGE, safeReturnPath } from "@/lib/auth/returnTo";

/**
 * Remembers where a client-side action wanted to go before it discovered the
 * visitor was signed out — "add to bag" and the wishlist heart, which can't set
 * a cookie themselves.
 */
export async function rememberReturnTo(path: string): Promise<void> {
  const store = await cookies();
  store.set(RETURN_TO_COOKIE, safeReturnPath(path), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: RETURN_TO_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

/** Clears it once the visitor has been sent on, so it can't fire again later. */
export async function clearReturnTo(): Promise<void> {
  const store = await cookies();
  store.delete(RETURN_TO_COOKIE);
}
