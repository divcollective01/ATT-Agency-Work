import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyOAuthState } from "@/lib/oauth-state";
import { upsertEncryptedConnection } from "@/lib/platform-connections";
import { decryptToken } from "@/lib/crypto";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/stripe/callback?code=...&state=...
 *
 * Uses service-role Supabase client because session cookies are not reliably
 * available after an external OAuth redirect on Cloudflare Pages edge runtime.
 * The AES-GCM encrypted state parameter is the authentication mechanism.
 */

type StripeTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  stripe_user_id?: string;
  scope?: string;
  livemode?: boolean;
  token_type?: string;
  stripe_publishable_key?: string;
  error?: string;
  error_description?: string;
};

function appBase(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin
  ).replace(/\/$/, "");
}

function redirectWithError(req: Request, message: string): NextResponse {
  const target = new URL(`${appBase(req)}/surcharge`);
  target.searchParams.set("stripe_error", message);
  return NextResponse.redirect(target.toString(), { status: 302 });
}

function fromUrlSafe(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (oauthError) return redirectWithError(req, oauthError);
  if (!code || !state) {
    return redirectWithError(req, "Stripe redirect was missing `code` or `state`.");
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
      expectedPlatform: "stripe",
    });
    authUserId = payload.uid;
  } catch (err) {
    return redirectWithError(
      req,
      err instanceof Error ? err.message : "Invalid OAuth state."
    );
  }

  // ── Resolve internal user ID via service role ─────────────────────────────
  const serviceDb = createSupabaseServiceClient();
  const { data: userRow } = await serviceDb
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!userRow?.id) {
    return redirectWithError(req, "User account not found — please sign in first.");
  }

  // ── Stripe token exchange ─────────────────────────────────────────────────
  const platformKey = process.env.STRIPE_SECRET_KEY;
  if (!platformKey) {
    return redirectWithError(req, "STRIPE_SECRET_KEY not configured on platform.");
  }

  let tokens: StripeTokenResponse;
  try {
    const tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platformKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
      }).toString(),
    });
    tokens = (await tokenRes.json()) as StripeTokenResponse;
    if (!tokenRes.ok || tokens.error || !tokens.access_token || !tokens.stripe_user_id) {
      return redirectWithError(
        req,
        tokens.error_description ?? tokens.error ?? `Stripe token exchange failed (${tokenRes.status})`
      );
    }
  } catch (err) {
    return redirectWithError(
      req,
      err instanceof Error ? err.message : "Stripe token exchange threw."
    );
  }

  // ── Persist encrypted credentials ─────────────────────────────────────────
  try {
    await upsertEncryptedConnection(serviceDb as any, {
      internalUserId: userRow.id,
      platform: "stripe",
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token ?? null,
      stripeUserId: tokens.stripe_user_id!,
      scope: tokens.scope ?? null,
    });
  } catch (err) {
    return redirectWithError(
      req,
      err instanceof Error ? err.message : "Failed to persist Stripe connection."
    );
  }

  const success = new URL(`${appBase(req)}/surcharge`);
  success.searchParams.set("stripe_connected", "1");
  return NextResponse.redirect(success.toString(), { status: 302 });
}
