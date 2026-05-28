/**
 * Microsoft Graph API helpers for the Negotiation Tool email flow.
 *
 * Runs entirely under the Edge runtime:
 *   - No Node.js dependencies
 *   - All HTTP via `fetch`
 *   - Graph API uses JSON — no MIME encoding required
 *
 * Token lifecycle:
 *   Microsoft access tokens expire after ~1 hour. Unlike Google, Microsoft
 *   rotates the refresh token on each use — the caller MUST persist both
 *   the new access token AND the new refresh token returned by
 *   `refreshMicrosoftToken`, otherwise the next refresh will fail.
 */

const GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail";
const MS_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

// ── Public API ────────────────────────────────────────────────────────────────

export type OutlookSendResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send a plain-text email via Microsoft Graph as the authenticated user.
 * The Graph API infers the sender from the access token — no `from` field
 * is required (Graph will use the authenticated account's primary address).
 */
export async function sendViaOutlook(opts: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
}): Promise<OutlookSendResult> {
  let res: Response;
  try {
    res = await fetch(GRAPH_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: {
            contentType: "Text",
            content: opts.body,
          },
          toRecipients: [
            {
              emailAddress: { address: opts.to },
            },
          ],
        },
        saveToSentItems: true,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error reaching Microsoft Graph: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Graph sendMail returns 202 Accepted with an empty body on success.
  if (res.status === 202 || res.status === 200) return { ok: true };

  let errMsg = `HTTP ${res.status}`;
  try {
    const body: { error?: { message?: string; code?: string } } =
      await res.json();
    errMsg = body.error?.message ?? body.error?.code ?? errMsg;
  } catch {
    // ignore parse failure — use the status-code message
  }

  return { ok: false, error: `Microsoft Graph: ${errMsg}` };
}

export type MicrosoftTokenRefreshResult = {
  accessToken: string;
  /** Microsoft rotates the refresh token on each use. Persist this. */
  refreshToken: string;
  /** ISO-8601 timestamp of when this access token expires. */
  expiresAt: string;
};

/**
 * Exchange a stored Microsoft refresh token for fresh tokens.
 *
 * IMPORTANT: Microsoft rotates the refresh token on every use. The caller
 * must update BOTH `accessToken` and `refreshToken` in Supabase, otherwise
 * the next refresh will fail with `invalid_grant`.
 *
 * Throws if the refresh fails (e.g. user revoked consent). Caller should
 * catch and prompt the user to reconnect.
 */
export async function refreshMicrosoftToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<MicrosoftTokenRefreshResult> {
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
      scope:
        "https://graph.microsoft.com/Mail.Send offline_access openid email profile",
    }).toString(),
  });

  const data: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Microsoft token refresh failed: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`
    );
  }

  if (!data.refresh_token) {
    throw new Error(
      "Microsoft token refresh did not return a new refresh token. " +
        "The user must reconnect."
    );
  }

  const expiresIn = data.expires_in ?? 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}
