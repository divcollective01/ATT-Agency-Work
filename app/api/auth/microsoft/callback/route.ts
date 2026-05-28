import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyOAuthState } from "@/lib/oauth-state";
import { upsertEncryptedConnection } from "@/lib/platform-connections";
import { decryptToken } from "@/lib/crypto";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft/callback
 *
 * Uses service-role Supabase client because session cookies are not reliably
 * available after an external OAuth redirect on Cloudflare Pages edge runtime.
 * The AES-GCM encrypted state parameter is the authentication mechanism.
 *
 * Flow:
 *   1. Decrypt the `state` param → extract authUserId (CSRF proof, 10-min TTL).
 *   2. Look up the internal public.users row by authUserId via service role.
 *   3. Exchange the `code` for access + refresh tokens.
 *   4. Fetch the user's Microsoft profile via Graph /me.
 *   5. Encrypt both tokens and upsert into `platform_connections`.
 *   6. Redirect to /negotiate?email_connected=microsoft.
 *
 * Required env vars:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_APP_URL
 */

function fromUrlSafe(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64;
}

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

  // ── Extract authUserId from encrypted state ───────────────────────────────
  let authUserId: string;
  try {
    const [ivPart, ctPart] = state.split(".");
    if (!ivPart || !ctPart) throw new Error("Malformed state token");
    const json = await decryptToken({
      iv: fromUrlSafe(ivPart),
      ciphertext: fromUrlSafe(ctPart),
    });
    const payload = JSON.parse(json) as { uid: string; platform: string; ts: number };
    await verifyOAuthState({
      state,
      expectedAuthUserId: payload.uid,
      expectedPlatform: "microsoft",
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
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${negotiateUrl}?email_error=${encodeURIComponent("Microsoft credentials not configured on server")}`
    );
  }

  const redirectUri = `${appUrl}/api/auth/microsoft/callback`;

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

  // ── Fetch Microsoft profile via Graph /me ─────────────────────────────────
  let profile: { displayName?: string; mail?: string; userPrincipalName?: string } = {};
  try {
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (profileRes.ok) profile = await profileRes.json();
  } catch {
    // non-fatal — proceed without display name
  }

  // `mail` is the primary SMTP address; `userPrincipalName` is the fallback
  const connectedEmail = profile.mail ?? profile.userPrincipalName ?? null;

  const expiresIn = tokenData.expires_in ?? 3600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // ── Persist encrypted credentials via service role ────────────────────────
  try {
    await upsertEncryptedConnection(serviceDb as any, {
      internalUserId,
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
