import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOAuthState } from "@/lib/oauth-state";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft/connect
 *
 * Builds the Microsoft OAuth 2.0 authorization URL and redirects the user
 * to Microsoft's consent screen. Uses the "common" tenant endpoint so both
 * personal Microsoft accounts (Outlook.com) and work/school accounts
 * (Microsoft 365) can authorize.
 *
 * Requested scopes:
 *   - openid / email / profile  — user identity for display
 *   - Mail.Send                 — send emails on the user's behalf
 *   - offline_access            — receive a refresh token
 *
 * Required env vars:
 *   MICROSOFT_CLIENT_ID    App registration client ID from Azure Portal
 *   NEXT_PUBLIC_APP_URL    External base URL (redirect URI must be registered)
 */
export async function GET() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId) {
    return NextResponse.json(
      { error: "MICROSOFT_CLIENT_ID is not configured." },
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
    platform: "microsoft",
  });

  const redirectUri = `${appUrl}/api/auth/microsoft/callback`;

  const authorizeUrl = new URL(
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
  );
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "profile",
      "offline_access",
      "https://graph.microsoft.com/Mail.Send",
    ].join(" ")
  );
  authorizeUrl.searchParams.set("state", state);
  // prompt=consent ensures we always get offline_access / refresh token
  authorizeUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(authorizeUrl.toString());
}
