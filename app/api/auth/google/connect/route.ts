import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOAuthState } from "@/lib/oauth-state";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/connect
 *
 * Builds the Google OAuth 2.0 authorization URL and redirects the user to
 * Google's consent screen. Requested scopes:
 *   - openid / email / profile  — user identity for display
 *   - gmail.send                — send emails on the user's behalf
 *
 * `access_type=offline` + `prompt=consent` ensures we receive a refresh token
 * every time (Google only issues one on first authorization otherwise).
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID       OAuth 2.0 client ID from Google Cloud Console
 *   NEXT_PUBLIC_APP_URL    External base URL (redirect_uri must be whitelisted)
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID is not configured." },
      { status: 500 }
    );
  }
  if (!appUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_APP_URL is not configured." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const state = await signOAuthState({
    authUserId: user.id,
    platform: "google",
  });

  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.send",
    ].join(" ")
  );
  authorizeUrl.searchParams.set("access_type", "offline");
  // prompt=consent ensures we always get a refresh token, even on re-auth
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl.toString());
}
