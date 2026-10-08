import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Request-scoped SSR client bound to the user's auth cookies. Runs queries AS
 * THE USER, so RLS policies apply. Use in Server Components, Route Handlers,
 * and Server Actions where authorization must reflect the logged-in user.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies are read-only. Safe
            // to ignore — session refresh is handled by middleware.
          }
        },
      },
    }
  );
}
