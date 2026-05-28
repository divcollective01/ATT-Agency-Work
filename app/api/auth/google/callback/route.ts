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
 * GET /api/auth/google/callback
 *
 * Handles the OAuth 2.0 authorization code redirect from Google.
 *
 * Flow:
 *   1. Verify the `state` param (CSRF protection, 10-min TTL).
 *   2. Exchange the `code` for access + refresh tokens.
 *   3. Fetch the user's Google profile (email, display name).
 *   4. Encrypt both tokens and upsert into `platform_connections`.
 *   5. Redirect to /negotiate?email_connected=google.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXT_PUBLIC_APP_URL
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const negotiateUrl = `${appUrl}/negotiate`;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(errorParam)}`
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
      expectedPlatform: "google",
    });
  } catch (err) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        err instanceof Error ? err.message : "State verification failed"
      )}`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("Google credentials not configured on server")}`
    );
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`;

  // ── Token exchange ──────────────────────────────────────────────────────────
  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
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
        tokenData.error_description ?? tokenData.error ?? "Token exchange returned no access token"
      )}`
    );
  }

  if (!tokenData.refresh_token) {
    // This should not happen when prompt=consent + access_type=offline are set,
    // but guard against it — without a refresh token the connection is useless
    // after the access token expires.
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        "Google did not return a refresh token. Please try reconnecting."
      )}`
    );
  }

  // ── Fetch Google profile ────────────────────────────────────────────────────
  let profile: { email?: string; name?: string } = {};
  try {
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    if (profileRes.ok) {
      profile = await profileRes.json();
    }
  } catch {
    // non-fatal — proceed without display name
  }

  const expiresIn = tokenData.expires_in ?? 3600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // ── Persist encrypted credentials ──────────────────────────────────────────
  try {
    await upsertEncryptedConnection(supabase, {
      internalUserId: caller.internalUserId,
      platform: "google",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      connectedEmail: profile.email ?? null,
      connectedName: profile.name ?? null,
      tokenExpiresAt,
      scope: "gmail.send",
    });
  } catch (err) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        err instanceof Error ? err.message : "Failed to store credentials"
      )}`
    );
  }

  return NextResponse.redirect(`${negotiateUrl}?email_connected=google`);
}
