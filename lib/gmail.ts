/**
 * Gmail API helpers for the Negotiation Tool email flow.
 *
 * Runs entirely under the Edge runtime (Cloudflare Workers / Next.js Edge):
 *   - No Node.js `Buffer` — base64 is handled via btoa + TextEncoder
 *   - No npm MIME library — RFC 2822 message is hand-built (it's simple)
 *   - All HTTP via `fetch`
 *
 * Token lifecycle:
 *   Google access tokens expire after 1 hour. `refreshGoogleToken` exchanges
 *   the stored refresh token for a fresh access token; callers (the email/send
 *   route) are responsible for persisting the new token back to Supabase.
 */

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// ── RFC 2047 subject encoding ─────────────────────────────────────────────────

/**
 * Encode a header value as RFC 2047 UTF-8 Base64 if it contains non-ASCII
 * characters. Required by spec; most MUAs also accept raw UTF-8, but being
 * compliant avoids garbled subjects in older clients.
 */
function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

// ── MIME message builder ──────────────────────────────────────────────────────

/**
 * Build a minimal RFC 2822 MIME message suitable for the Gmail API's raw
 * message endpoint. The body is sent as UTF-8 plain text.
 */
function buildMimeMessage(opts: {
  from: string; // "Display Name <email@gmail.com>"
  to: string;
  subject: string;
  body: string;
}): string {
  const lines = [
    "MIME-Version: 1.0",
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.body,
  ];
  return lines.join("\r\n");
}

/**
 * Base64url-encode a UTF-8 string for the Gmail API `raw` field.
 * Uses TextEncoder → binary string → btoa → URL-safe substitution.
 * No `Buffer` dependency, safe for Edge / Workers.
 */
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Public API ────────────────────────────────────────────────────────────────

export type GmailSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Send a plain-text email via the Gmail API as the authenticated user.
 *
 * The `from` field must match (or be a send-as alias of) the authenticated
 * account; Gmail enforces this server-side and will silently substitute the
 * primary address if mismatched, so always pass the connected email here.
 */
export async function sendViaGmail(opts: {
  accessToken: string;
  from: string; // "Display Name <email@gmail.com>"
  to: string;
  subject: string;
  body: string;
}): Promise<GmailSendResult> {
  const mime = buildMimeMessage(opts);
  const raw = toBase64Url(mime);

  let res: Response;
  try {
    res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error reaching Gmail API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const data: { id?: string; error?: { message?: string; status?: string } } =
    await res.json();

  if (!res.ok) {
    const msg =
      data.error?.message ?? data.error?.status ?? `HTTP ${res.status}`;
    return { ok: false, error: `Gmail API: ${msg}` };
  }

  return { ok: true, messageId: data.id ?? "" };
}

export type GoogleTokenRefreshResult = {
  accessToken: string;
  /** ISO-8601 timestamp of when this access token expires. */
  expiresAt: string;
};

/**
 * Exchange a stored Google refresh token for a fresh access token.
 * Google does NOT rotate the refresh token on each use (unlike Microsoft),
 * so the caller only needs to update the access token + expiry in Supabase.
 *
 * Throws if the refresh fails (e.g. user revoked access). Caller should catch
 * and prompt the user to reconnect.
 */
export async function refreshGoogleToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<GoogleTokenRefreshResult> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  const data: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token refresh failed: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`
    );
  }

  const expiresIn = data.expires_in ?? 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return { accessToken: data.access_token, expiresAt };
}

/**
 * Best-effort token revocation on disconnect. Silently swallows errors —
 * the local row is deleted regardless of whether revocation succeeds.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
  } catch {
    // ignore — best-effort only
  }
}
