import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { RETURN_TO_COOKIE, RETURN_TO_MAX_AGE } from "@/lib/auth/returnTo";

/**
 * Refreshes the Supabase session on every request, and gates the signed-in-only
 * areas.
 *
 * Gating lives here rather than in each page because this is the only place
 * that can both redirect AND set a cookie — Server Components can read cookies
 * but not write them. That cookie is how the destination survives the trip
 * through sign-in without ever appearing in the URL as `?next=`.
 *
 * Pages still re-check the session themselves; this is a redirect for humans,
 * not the authorization boundary. RLS is that.
 */

/** Signed-in-only prefixes. `/sell` is public — it is the pitch, not the tool. */
const PROTECTED = ["/account", "/cart", "/checkout", "/wishlist", "/seller", "/admin"];

/** Somewhere a brand-new visitor is more likely to need an account than a login. */
const PREFERS_SIGNUP = ["/seller/onboarding"];

/**
 * Is this the visitor actually asking for this page, or speculation?
 *
 * Both matter and they look alike. Observed from a real browser:
 *
 *   prefetch of <Link href="/cart">   rsc: 1, next-router-prefetch: 1
 *   click on   <Link href="/cart">    rsc: 1, next-router-prefetch: absent
 *
 * Neither carries Sec-Fetch-Dest, because both are fetch() calls rather than
 * document loads. So "document navigations only" would have thrown away every
 * in-app link click — which is how the primary "Start selling" button lost its
 * destination and dropped new sellers on the home page after signup.
 *
 * Recording everything except prefetches keeps click navigations working while
 * stopping the header's /cart, /wishlist and /account prefetches from
 * overwriting the page the visitor actually asked for.
 */
function isPrefetch(request: NextRequest): boolean {
  const headers = request.headers;
  return (
    // Next sets this on <Link> prefetches; presence is the signal, not its value.
    headers.get("next-router-prefetch") !== null ||
    // Browser-level speculative fetching.
    headers.get("purpose") === "prefetch" ||
    headers.get("x-purpose") === "prefetch" ||
    headers.get("x-moz") === "prefetch" ||
    (headers.get("sec-purpose")?.includes("prefetch") ?? false)
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touching getUser() refreshes the token when near expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (needsAuth && !user) {
    const target = PREFERS_SIGNUP.some((p) => pathname.startsWith(p)) ? "/signup" : "/login";
    const redirectTo = NextResponse.redirect(new URL(target, request.url));

    // Carry the session cookies the refresh may have just set, or the visitor
    // arrives at the login page having lost their refreshed token.
    response.cookies.getAll().forEach((cookie) => redirectTo.cookies.set(cookie));

    if (!isPrefetch(request)) {
      // Search params are preserved so a filtered or paginated view survives.
      redirectTo.cookies.set(RETURN_TO_COOKIE, `${pathname}${request.nextUrl.search}`, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: RETURN_TO_MAX_AGE,
        secure: process.env.NODE_ENV === "production",
      });
    }
    return redirectTo;
  }

  return response;
}

export const config = {
  // Skip static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
