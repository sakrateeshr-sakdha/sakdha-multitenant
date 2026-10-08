import { cookies } from "next/headers";

/**
 * Where to send someone after they sign in.
 *
 * Deliberately a cookie rather than a `?next=` query string: the destination is
 * an implementation detail, not something that belongs in a URL the user sees,
 * copies or shares. Keeping it out of the URL also removes a reflected-input
 * surface — a `next` param has to be validated on every read or it becomes an
 * open redirect.
 */

export const RETURN_TO_COOKIE = "sakdha-return-to";

/** Long enough to survive an email-confirmation round trip, short enough to go stale. */
export const RETURN_TO_MAX_AGE = 60 * 60;

/**
 * Only same-site absolute paths are ever accepted. Even though we write this
 * cookie ourselves, treating it as untrusted on read costs nothing and means a
 * tampered cookie cannot bounce a user off-site.
 */
export function safeReturnPath(value: string | undefined | null, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback; // protocol-relative → another host
  if (value.includes("\\")) return fallback;
  return value;
}

/** Reads the pending destination, for the sign-in pages. */
export async function peekReturnTo(fallback = "/"): Promise<string> {
  const store = await cookies();
  return safeReturnPath(store.get(RETURN_TO_COOKIE)?.value, fallback);
}
