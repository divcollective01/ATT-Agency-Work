import { NextResponse, type NextRequest } from "next/server";
import {
  EMAIL_EXISTS_SIGNIN_MESSAGE,
  isEmailExistsError,
  loginErrorRedirectUrl
} from "@/lib/auth-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

const ALLOWED_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email"
]);

function safeNextPath(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function callbackErrorRedirect(
  origin: string,
  error: { code?: string; message: string; status?: number }
): NextResponse {
  const message = isEmailExistsError(error) ? EMAIL_EXISTS_SIGNIN_MESSAGE : error.message;
  return NextResponse.redirect(loginErrorRedirectUrl(origin, message));
}

/**
 * Hash-fragment fallback for Supabase's implicit-flow recovery emails.
 * Those land here as `/auth/callback#access_token=...&type=recovery` and
 * the browser never forwards the fragment to the server, so this route
 * handler sees an empty query string. A 3xx redirect would *also* strip
 * the fragment, permanently losing the recovery token.
 *
 * Instead we return a tiny inline HTML shim whose script reads
 * `window.location.hash` and `location.replace()`s the browser — fragment
 * intact — to the destination page (`/update-password` for recovery,
 * `/` otherwise). The destination's Supabase browser client then picks
 * up the fragment, stores the session in cookies, and fires
 * PASSWORD_RECOVERY via onAuthStateChange. See
 * components/auth/anonymous-auth-provider.tsx for that side.
 */
function hashFragmentFallback(): NextResponse {
  const emailExistsMessage = JSON.stringify(EMAIL_EXISTS_SIGNIN_MESSAGE);
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex" />
  <title>Finishing sign-in&hellip;</title>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#15100D;color:#F5EFE6;padding:24px">
  <p>Finishing sign-in&hellip;</p>
  <script>
    (function () {
      var hash = window.location.hash || "";
      var params = new URLSearchParams(hash.replace(/^#/, ""));
      var errorCode = params.get("error") || params.get("error_code");
      if (errorCode) {
        var description = params.get("error_description") || errorCode;
        var lowerDescription = description.toLowerCase();
        var isEmailExists = errorCode === "email_exists" ||
          (lowerDescription.indexOf("email") !== -1 &&
            (lowerDescription.indexOf("exists") !== -1 ||
              lowerDescription.indexOf("registered") !== -1 ||
              lowerDescription.indexOf("already") !== -1));
        var friendly = isEmailExists ? ${emailExistsMessage} : description;
        window.location.replace(
          "/login?mode=signin&error=" + encodeURIComponent(friendly)
        );
        return;
      }
      var type = params.get("type");
      var dest = type === "recovery" ? "/update-password" : "/";
      // Preserve the fragment so the destination page's Supabase browser
      // client can detectSessionInUrl and finalize the session.
      window.location.replace(dest + hash);
    })();
  </script>
  <noscript>JavaScript is required to finish signing in. Please enable it and try again.</noscript>
</body>
</html>`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/**
 * Callback for every Supabase auth flow that hands the browser back a
 * one-time token: email verification, password recovery, magic links.
 *
 * Three URL shapes are possible depending on the project's email templates:
 *   - PKCE:                 /auth/callback?code=...&next=/...
 *   - OTP (token_hash):     /auth/callback?token_hash=...&type=...&next=/...
 *   - Implicit (hash frag): /auth/callback#access_token=...&type=recovery
 *
 * We handle all three. `next` is restricted to in-app paths to prevent
 * open redirects.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return callbackErrorRedirect(origin, error);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (tokenHash && rawType && ALLOWED_OTP_TYPES.has(rawType as EmailOtpType)) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: rawType as EmailOtpType
    });
    if (error) {
      return callbackErrorRedirect(origin, error);
    }
    // For recovery, force /update-password regardless of ?next= so the
    // new session is consumed by the password form instead of silently
    // logging the user into the dashboard.
    const dest = rawType === "recovery" ? "/update-password" : next;
    return NextResponse.redirect(`${origin}${dest}`);
  }

  // Neither query param is present — the token is almost certainly in
  // the URL fragment (Supabase's implicit-flow recovery emails). Hand
  // control to the browser instead of redirecting, otherwise the
  // fragment is permanently lost.
  return hashFragmentFallback();
}
