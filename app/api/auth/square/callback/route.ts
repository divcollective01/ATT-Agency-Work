import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyOAuthState } from "@/lib/oauth-state";
import { upsertEncryptedConnection } from "@/lib/platform-connections";
import { decryptToken } from "@/lib/crypto";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/square/callback?code=...&state=...
 *
 * Uses service-role Supabase client because session cookies are not reliably
 * available after an external OAuth redirect on Cloudflare Pages edge runtime.
 * The AES-GCM encrypted state parameter is the authentication mechanism.
 *
 * Square access tokens currently expire after 30 days and must be refreshed
 * with the refresh_token; we persist `expires_at` so a future cron can
 * pre-rotate before it expires.
 */

type SquareTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_at?: string;
  merchant_id?: string;
  refresh_token?: string;
  short_lived?: boolean;
  errors?: Array<{ category?: string; code?: string; detail?: string }>;
};

function squareBase(): string {
  return process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function appBase(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin
  ).replace(/\/$/, "");
}

function redirectWithError(req: Request, message: string): NextResponse {
  const target = new URL(`${appBase(req)}/surcharge`);
  target.searchParams.set("square_error", message);
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
  const denyError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (denyError) return redirectWithError(req, denyError);
  if (!code || !state) {
    return redirectWithError(req, "Square redirect was missing `code` or `state`.");
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
      expectedPlatform: "square",
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

  // ── Square token exchange ──────────────────────────────────────────────────
  const clientId = process.env.SQUARE_APPLICATION_ID;
  const clientSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!clientId || !clientSecret) {
    return redirectWithError(
      req,
      "SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET must both be configured."
    );
  }

  let tokens: SquareTokenResponse;
  try {
    const tokenRes = await fetch(`${squareBase()}/oauth2/token`, {
      method: "POST",
      headers: {
        "Square-Version": "2025-09-24",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
    });
    tokens = (await tokenRes.json()) as SquareTokenResponse;
    if (
      !tokenRes.ok ||
      tokens.errors?.length ||
      !tokens.access_token ||
      !tokens.merchant_id
    ) {
      const msg =
        tokens.errors?.[0]?.detail ??
        tokens.errors?.[0]?.code ??
        `Square token exchange failed with status ${tokenRes.status}`;
      return redirectWithError(req, msg);
    }
  } catch (err) {
    return redirectWithError(
      req,
      err instanceof Error ? err.message : "Square token exchange threw."
    );
  }

  // ── Persist encrypted credentials ─────────────────────────────────────────
  try {
    await upsertEncryptedConnection(serviceDb as any, {
      internalUserId: userRow.id,
      platform: "square",
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token ?? null,
      squareMerchantId: tokens.merchant_id!,
      tokenExpiresAt: tokens.expires_at ?? null,
    });
  } catch (err) {
    return redirectWithError(
      req,
      err instanceof Error ? err.message : "Failed to persist Square connection."
    );
  }

  const success = new URL(`${appBase(req)}/surcharge`);
  success.searchParams.set("square_connected", "1");
  return NextResponse.redirect(success.toString(), { status: 302 });
}
