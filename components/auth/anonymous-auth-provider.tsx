"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Routes where the visitor is in the middle of an auth flow. We must NOT
 * mint an anonymous session on these pages — it would either clobber a
 * pending recovery / verify session that the Supabase browser client is
 * about to establish from a URL fragment, or attach an anonymous user to
 * a page that's specifically about signing in / out.
 */
const AUTH_FLOW_PATHS = new Set([
  "/login",
  "/forgot-password",
  "/update-password",
]);

function isAuthFlowPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (AUTH_FLOW_PATHS.has(pathname)) return true;
  return pathname.startsWith("/auth/");
}

/**
 * The Supabase browser client auto-detects sessions in URL fragments
 * (`#access_token=...&type=recovery`). If we mint an anonymous session
 * before that detection completes, we race the recovery — so spot the
 * fragment ourselves and skip the anonymous bootstrap entirely.
 */
function hasInflightHashSession(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash || "";
  return hash.includes("access_token=") || hash.includes("type=recovery");
}

/**
 * Once the recovery session is stored in cookies, scrub the access_token
 * out of the address bar so it doesn't survive in browser history or
 * leak via copy-paste. The Supabase browser client also clears the hash
 * itself; this is a belt for that suspender.
 */
function stripAuthHash(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  const cleanUrl = window.location.pathname + window.location.search;
  window.history.replaceState({}, document.title, cleanUrl);
}

/**
 * Silent Auth + Recovery Routing.
 *
 * 1. Subscribes to onAuthStateChange so PASSWORD_RECOVERY — fired by
 *    Supabase once the browser client has consumed a recovery link's URL
 *    fragment and stored the resulting session in cookies — reliably
 *    routes the user to /update-password and refreshes server components.
 *
 * 2. On first mount (and only if no session exists, the visitor isn't
 *    already in an auth flow, and there's no inflight recovery hash),
 *    creates a Supabase anonymous user. Pairs with the
 *    on_auth_user_created trigger in supabase/schema.sql, which inserts
 *    a matching public.users row.
 *
 * Returning anonymous visitors keep their materials because the session
 * lives in cookies and is reused across visits on the same browser.
 * Clearing site data == losing the session (strict per-user RLS still
 * applies).
 */
export function AnonymousAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    // createSupabaseBrowserClient returns null (and logs) when the
    // NEXT_PUBLIC_SUPABASE_* env vars are missing from the build. Bail
    // silently rather than throwing into React's error boundary.
    if (!supabase) return;

    // Subscribe FIRST so we never miss PASSWORD_RECOVERY. The Supabase
    // browser client can finish processing a URL fragment between the
    // time this effect mounts and the time the getSession() promise
    // below resolves.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;

        if (event === "PASSWORD_RECOVERY" && session) {
          // We now hold a verified, short-lived recovery session in
          // cookies. Strip the token from the URL and land the user on
          // the password-update form. router.refresh() forces the
          // server component to re-read auth cookies and render the
          // real form instead of the "request a new link" fallback.
          stripAuthHash();
          if (window.location.pathname !== "/update-password") {
            router.replace("/update-password");
          } else {
            router.refresh();
          }
        }
      }
    );

    (async () => {
      // Don't bootstrap an anonymous session if the visitor is mid-flow
      // (e.g. about to sign in) or if a recovery hash is still being
      // processed by the browser client.
      if (isAuthFlowPath(pathname) || hasInflightHashSession()) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session || cancelled) return;

      const { error } = await supabase.auth.signInAnonymously();
      if (cancelled) return;
      if (error) {
        // Most common cause: Anonymous Sign-Ins is disabled in the
        // Supabase dashboard under Authentication → Providers. Enable
        // it there.
        console.error("[auth] anonymous sign-in failed:", error.message);
        return;
      }

      // Server components read auth from cookies(); they won't see the
      // new session until the next request. router.refresh() triggers
      // exactly that without losing client state.
      router.refresh();
    })();

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [router, pathname]);

  return <>{children}</>;
}
