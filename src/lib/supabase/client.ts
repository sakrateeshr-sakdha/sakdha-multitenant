import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Anon key only — all privileged reads/writes are
 * governed by RLS. Used from Client Components.
 *
 * Do NOT set a custom `storageKey` here. With @supabase/ssr the session lives
 * in a cookie, and `storageKey` renames that cookie for the browser only —
 * `createServerClient` and the middleware keep reading the default
 * `sb-<project-ref>-auth-token`. The mismatch is silent: sign-in appears to
 * work, then every Server Component and Server Action sees an anonymous user.
 * Collisions with the sibling boutique app on localhost are already avoided
 * because the default name is namespaced by Supabase project ref.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    }
  );
}
