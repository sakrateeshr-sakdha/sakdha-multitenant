import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { RETURN_TO_COOKIE, safeReturnPath } from "@/lib/auth/returnTo";

/**
 * PKCE callback: exchanges the one-time code for a session cookie. Used by
 * email confirmation links and any future OAuth provider.
 *
 * The destination comes from the return-to cookie, not a `next` parameter, so
 * the confirmation link we email is a clean URL that reveals nothing about
 * where the person was headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const destination = safeReturnPath(request.cookies.get(RETURN_TO_COOKIE)?.value, "/");
  const response = NextResponse.redirect(`${origin}${destination}`);
  // Consume it, so a later visit is not silently redirected.
  response.cookies.delete(RETURN_TO_COOKIE);
  return response;
}
