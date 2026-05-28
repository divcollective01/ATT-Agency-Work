import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  resolveCaller,
  loadDecryptedConnection,
  upsertEncryptedConnection,
  tokenNeedsRefresh,
  type DecryptedConnection,
} from "@/lib/platform-connections";
import {
  sendViaGmail,
  refreshGoogleToken,
} from "@/lib/gmail";
import {
  sendViaOutlook,
  refreshMicrosoftToken,
} from "@/lib/outlook";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/email/send
 *
 * Sends a negotiation email via the user's connected Gmail or Outlook account.
 *
 * Token lifecycle is handled transparently:
 *   - If the stored access token is expired (or within 5 min of expiry), it is
 *     refreshed automatically before the send.
 *   - Microsoft rotates the refresh token on each use; both tokens are
 *     re-persisted atomically after a successful refresh.
 *   - If refresh fails (e.g. user revoked access), a 401-equivalent JSON error
 *     is returned with `needsReconnect: true` so the UI can prompt the user.
 *
 * Body: { to, subject, body }
 *
 * The `from` display name is pulled from the caller's `public.users.business_name`
 * so it is always the company name rather than the personal account name.
 */

type RequestBody = {
  to: string;
  subject: string;
  body: string;
};

// ── Token refresh helpers ─────────────────────────────────────────────────────

async function refreshAndPersist(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  conn: DecryptedConnection,
  internalUserId: string
): Promise<string> {
  if (!conn.refreshToken) {
    throw new Error(
      `Your ${conn.platform === "google" ? "Gmail" : "Outlook"} token has expired and no refresh token is stored. Please reconnect.`
    );
  }

  if (conn.platform === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.");
    }

    const refreshed = await refreshGoogleToken({
      clientId,
      clientSecret,
      refreshToken: conn.refreshToken,
    });

    // Google does not rotate the refresh token — only update access token + expiry
    await upsertEncryptedConnection(supabase, {
      internalUserId,
      platform: "google",
      accessToken: refreshed.accessToken,
      refreshToken: conn.refreshToken, // unchanged
      connectedEmail: conn.connectedEmail,
      connectedName: conn.connectedName,
      tokenExpiresAt: refreshed.expiresAt,
      scope: conn.scope,
    });

    return refreshed.accessToken;
  }

  // Microsoft
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not configured.");
  }

  const refreshed = await refreshMicrosoftToken({
    clientId,
    clientSecret,
    refreshToken: conn.refreshToken,
  });

  // Microsoft rotates the refresh token — persist both new tokens
  await upsertEncryptedConnection(supabase, {
    internalUserId,
    platform: "microsoft",
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    connectedEmail: conn.connectedEmail,
    connectedName: conn.connectedName,
    tokenExpiresAt: refreshed.expiresAt,
    scope: conn.scope,
  });

  return refreshed.accessToken;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();

  // ── Auth ──────────────────────────────────────────────────────────────────
  let caller: Awaited<ReturnType<typeof resolveCaller>>;
  try {
    caller = await resolveCaller(supabase);
  } catch (err) {
    return NextResponse.json(
      { sent: false, error: err instanceof Error ? err.message : "Auth error" },
      { status: 401 }
    );
  }
  if (!caller) {
    return NextResponse.json(
      { sent: false, error: "Not authenticated." },
      { status: 401 }
    );
  }

  // ── Business name for sender display ─────────────────────────────────────
  const { data: userRow } = await supabase
    .from("users")
    .select("business_name")
    .eq("auth_user_id", caller.authUserId)
    .maybeSingle();
  const businessName = userRow?.business_name?.trim() || "Profit Shield";

  // ── Parse request body ─────────────────────────────────────────────────────
  let payload: RequestBody;
  try {
    payload = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { sent: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { to, subject, body } = payload;
  if (!to || !subject || !body) {
    return NextResponse.json(
      { sent: false, error: "to, subject, and body are required" },
      { status: 400 }
    );
  }

  // ── Find connected email provider (Google preferred over Microsoft) ────────
  let conn: DecryptedConnection | null = null;
  for (const platform of ["google", "microsoft"] as const) {
    try {
      conn = await loadDecryptedConnection({
        supabase,
        internalUserId: caller.internalUserId,
        platform,
      });
      break; // use first connected provider found
    } catch {
      // not connected for this platform — try next
    }
  }

  if (!conn) {
    return NextResponse.json(
      {
        sent: false,
        error:
          "No email provider connected. Connect Gmail or Outlook from the Negotiation Tool.",
        needsConnect: true,
      },
      { status: 200 }
    );
  }

  // ── Refresh access token if needed ────────────────────────────────────────
  let accessToken = conn.accessToken;
  if (tokenNeedsRefresh(conn.tokenExpiresAt)) {
    try {
      accessToken = await refreshAndPersist(supabase, conn, caller.internalUserId);
    } catch (err) {
      return NextResponse.json(
        {
          sent: false,
          error:
            err instanceof Error
              ? err.message
              : "Token refresh failed. Please reconnect.",
          needsReconnect: true,
          platform: conn.platform,
        },
        { status: 200 }
      );
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  if (conn.platform === "google") {
    const fromAddress = conn.connectedEmail
      ? `${businessName} <${conn.connectedEmail}>`
      : businessName;

    const result = await sendViaGmail({
      accessToken,
      from: fromAddress,
      to,
      subject,
      body,
    });

    if (!result.ok) {
      // invalid_credentials / token revoked by user
      const needsReconnect =
        result.error.includes("401") ||
        result.error.includes("invalid_credentials") ||
        result.error.includes("Invalid Credentials");

      return NextResponse.json(
        { sent: false, error: result.error, needsReconnect, platform: "google" },
        { status: 200 }
      );
    }

    return NextResponse.json({
      sent: true,
      provider: "gmail",
      from: conn.connectedEmail,
    });
  }

  // Microsoft
  const result = await sendViaOutlook({ accessToken, to, subject, body });

  if (!result.ok) {
    const needsReconnect =
      result.error.includes("401") ||
      result.error.includes("InvalidAuthenticationToken") ||
      result.error.includes("Unauthorized");

    return NextResponse.json(
      { sent: false, error: result.error, needsReconnect, platform: "microsoft" },
      { status: 200 }
    );
  }

  return NextResponse.json({
    sent: true,
    provider: "outlook",
    from: conn.connectedEmail,
  });
}
