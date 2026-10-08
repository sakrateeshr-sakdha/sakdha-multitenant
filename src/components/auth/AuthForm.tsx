"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { clearReturnTo } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";

/**
 * Email + password auth against Supabase. The browser client from
 * @supabase/ssr writes the session to cookies, so Server Components and RLS
 * see the signed-in user on the very next request.
 *
 * Where to go afterwards arrives as a prop, resolved server-side from the
 * return-to cookie — never from a `?next=` parameter in the URL.
 */
export function AuthForm({ mode, returnTo }: { mode: "login" | "signup"; returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, role: "customer" },
            // The callback reads the same cookie, so the destination survives
            // the email round trip without riding in the link.
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;

        // With email confirmation on, there is no session yet.
        if (!data.session) {
          toast.success("Check your email to confirm your account.");
          setPending(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      // Consume the destination so a stale cookie cannot redirect a later visit.
      await clearReturnTo();
      toast.success(mode === "signup" ? "Welcome to Sakdha" : "Welcome back");
      router.push(returnTo);
      router.refresh(); // let Server Components pick up the new session
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      setPending(false);
    }
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/30";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && (
        <div>
          <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-ink-800">
            Full name
          </label>
          <input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoComplete="name"
            className={inputCls}
          />
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink-800">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink-800">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputCls}
        />
        {mode === "signup" && (
          <p className="mt-1.5 text-xs text-ink-400">At least 8 characters.</p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
      </Button>

      {/* The pending destination lives in a cookie, so these stay clean URLs. */}
      <p className="text-center text-sm text-ink-500">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Sakdha?{" "}
            <Link href="/signup" className="font-medium text-brand-600 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
