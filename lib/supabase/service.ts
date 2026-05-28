import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses Row Level Security.
 *
 * Use ONLY in server-side OAuth callbacks where the session cookie is not
 * available (e.g. after an external OAuth provider redirects back). The
 * caller is authenticated via the AES-GCM encrypted state parameter instead.
 *
 * Never expose this client to the browser. Never import it from client
 * components. The service role key must stay server-side only.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. " +
        "Add SUPABASE_SERVICE_ROLE_KEY to Cloudflare Pages encrypted secrets."
    );
  }

  return createClient(url, key, {
    auth: {
      // Disable auto session management — this client is stateless / server-only
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
