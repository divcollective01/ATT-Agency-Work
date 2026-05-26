"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Silent Auth: on first mount in any browser, check for an existing Supabase
 * session and, if missing, create an anonymous one. Then refresh the route so
 * server components re-render with the new auth cookies attached.
 *
 * Pairs with the `on_auth_user_created` trigger in supabase/schema.sql, which
 * auto-inserts a matching public.users row whenever auth creates a new user.
 *
 * Returning anonymous visitors keep their materials because the session lives
 * in cookies / localStorage and is reused across visits on the same browser.
 * Clearing site data == losing the session == losing access to previously
 * created rows (strict per-user RLS still applies).
 */
export function AnonymousAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session || cancelled) return;

      const { error } = await supabase.auth.signInAnonymously();
      if (cancelled) return;
      if (error) {
        // Most common cause: Anonymous Sign-Ins is disabled in the Supabase
        // dashboard under Authentication → Providers. Enable it there.
        console.error("[auth] anonymous sign-in failed:", error.message);
        return;
      }

      // Server components read auth from cookies(); they won't see the new
      // session until the next request. router.refresh() triggers exactly
      // that without losing client state.
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return <>{children}</>;
}
