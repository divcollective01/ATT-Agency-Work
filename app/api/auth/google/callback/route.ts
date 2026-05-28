import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyOAuthState } from "@/lib/oauth-state";
import { upsertEncryptedConnection } from "@/lib/platform-connections";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback
 *
 * Handles the OAuth 2.0 authorization code redirect from Google.
 *
 * Uses the service-role Supabase client because session cookies are not
 * reliably forwarded through external OAuth redirects on Cloudflare Pages
 * edge runtime. The AES-GCM encrypted state parameter is the authentication
 * mechanism — it embeds the auth user ID and is verified before any DB write.
 *
 * Flow:
 *   1. Verify the encrypted `state` param → extract authUserId (CSRF proof).
 *   2. Look up the internal public.users row by authUserId.
 *   3. Exchange the `code` for access + refresh tokens.
 *   4. Fetch Google profile (email, display name).
 *   5. Encrypt both tokens and upsert into `platform_connections`.
 *   6. Redirect to /negotiate?email_connected=google.
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
      `${negotiateUrl}?email_error=${encodeURIComponent("Missing code or state parameter")}`
    );
  }

  // ── Verify state first — this is our authentication ──────────────────────
  // The state is AES-GCM encrypted with the master key and contains the
  // authUserId. Verification proves the request was initiated by a logged-in
  // user on this platform (CSRF protection, 10-min TTL).
  //
  // We parse the state to extract the authUserId without knowing it up front,
  // then verify it matches the embedded uid (which verifyOAuthState checks).
  let authUserId: string;
  try {
    // Decode the state to extract authUserId before full verification
    const [ivPart, ctPart] = state.split(".");
    if (!ivPart || !ctPart) throw new Error("Malformed state token");

    const { decryptToken } = await import("@/lib/crypto");
    function fromUrlSafe(s: string): string {
      let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return b64;
    }
    const json = await decryptToken({
      iv: fromUrlSafe(ivPart),
      ciphertext: fromUrlSafe(ctPart),
    });
    const payload = JSON.parse(json) as { uid: string; platform: string; ts: number };

    // Now verify with the extracted uid (checks uid, platform, TTL)
    await verifyOAuthState({
      state,
      expectedAuthUserId: payload.uid,
      expectedPlatform: "google",
    });

    authUserId = payload.uid;
  } catch (err) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        err instanceof Error ? err.message : "State verification failed"
      )}`
    );
  }

  // ── Resolve internal user ID via service role (bypasses RLS) ─────────────
  const serviceDb = createSupabaseServiceClient();
  const { data: userRow } = await serviceDb
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!userRow?.id) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("User account not found — please sign in first")}`
    );
  }
  const internalUserId = userRow.id;

  // ── Token exchange ────────────────────────────────────────────────────────
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("Google credentials not configured on server")}`
    );
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`;

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
        tokenData.error_description ?? tokenData.error ?? "No access token returned"
      )}`
    );
  }

  if (!tokenData.refresh_token) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent(
        "Google did not return a refresh token. Please try disconnecting and reconnecting."
      )}`
    );
  }

  // ── Fetch Google profile ──────────────────────────────────────────────────
  let profile: { email?: string; name?: string } = {};
  try {
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    if (profileRes.ok) profile = await profileRes.json();
  } catch {
    // non-fatal — proceed without display name
  }

  const expiresIn = tokenData.expires_in ?? 3600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // ── Persist encrypted credentials via service role ────────────────────────
  try {
    await upsertEncryptedConnection(serviceDb as any, {
      internalUserId,
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
