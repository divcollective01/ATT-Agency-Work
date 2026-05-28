import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyOAuthState } from "@/lib/oauth-state";
import {
  resolveCaller,
  upsertEncryptedConnection,
} from "@/lib/platform-connections";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft/callback
 *
 * Handles the OAuth 2.0 authorization code redirect from Microsoft.
 *
 * Flow:
 *   1. Verify the `state` param (CSRF protection, 10-min TTL).
 *   2. Exchange the `code` for access + refresh tokens.
 *   3. Fetch the user's Microsoft profile via Graph /me.
 *   4. Encrypt both tokens and upsert into `platform_connections`.
 *   5. Redirect to /negotiate?email_connected=microsoft.
 *
 * Required env vars:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   NEXT_PUBLIC_APP_URL
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const negotiateUrl = `${appUrl}/negotiate`;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const errorDesc = searchParams.get("error_description");

  if (errorParam) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(errorDesc ?? errorParam)}`
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("Missing code or state")}`
    );
  }

  const supabase = createSupabaseServerClient();

  let caller: Awaited<ReturnType<typeof resolveCaller>>;
  try {
    caller = await resolveCaller(supabase);
  } catch {
    caller = null;
  }
  if (!caller) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("Not authenticated")}`
    );
  }

  // Verify CSRF state
  try {
    await verifyOAuthState({
      state,
      expectedAuthUserId: caller.authUserId,
      expectedPlatform: "microsoft",
    });
  } catch (err) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        err instanceof Error ? err.message : "State verification failed"
      )}`
    );
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("Microsoft credentials not configured on server")}`
    );
  }

  const redirectUri = `${appUrl}/api/auth/microsoft/callback`;

  // ── Token exchange ──────────────────────────────────────────────────────────
  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  try {
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          scope:
            "openid email profile offline_access https://graph.microsoft.com/Mail.Send",
        }).toString(),
      }
    );
    tokenData = await tokenRes.json();
  } catch (err) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        `Token exchange failed: ${err instanceof Error ? err.message : "network error"}`
      )}`
    );
  }

  if (!tokenData.access_token) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        tokenData.error_description ?? tokenData.error ?? "No access token returned"
      )}`
    );
  }

  if (!tokenData.refresh_token) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        "Microsoft did not return a refresh token. Please try reconnecting."
      )}`
    );
  }

  // ── Fetch Microsoft profile via Graph /me ──────────────────────────────────
  let profile: { displayName?: string; mail?: string; userPrincipalName?: string } =
    {};
  try {
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (profileRes.ok) {
      profile = await profileRes.json();
    }
  } catch {
    // non-fatal
  }

  // `mail` is the primary SMTP address; `userPrincipalName` is the fallback
  // (UPN looks like an email address for most accounts).
  const connectedEmail = profile.mail ?? profile.userPrincipalName ?? null;

  const expiresIn = tokenData.expires_in ?? 3600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // ── Persist encrypted credentials ──────────────────────────────────────────
  try {
    await upsertEncryptedConnection(supabase, {
      internalUserId: caller.internalUserId,
      platform: "microsoft",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      connectedEmail,
      connectedName: profile.displayName ?? null,
      tokenExpiresAt,
      scope: "Mail.Send",
    });
  } catch (err) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        err instanceof Error ? err.message : "Failed to store credentials"
      )}`
    );
  }

  return NextResponse.redirect(`${negotiateUrl}?email_connected=microsoft`);
}
