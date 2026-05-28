import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  decryptToken,
  encryptToken,
  tokenHint,
  type EncryptedPayload,
} from "@/lib/crypto";

/**
 * Helpers for reading and writing the `public.platform_connections` rows
 * that hold each user's encrypted OAuth credentials. Centralized here so
 * the OAuth callbacks and the runtime API routes use exactly the same
 * lookup + decryption + caller-resolution logic.
 *
 * All RLS gating happens at the Supabase layer — these helpers just thread
 * the calling auth user through and let Postgres enforce the policy.
 */

export type PlatformSlug = "stripe" | "square" | "google" | "microsoft";

export type ResolvedCaller = {
  /** auth.users.id from `supabase.auth.getUser()`. */
  authUserId: string;
  /** public.users.id — the FK target used by every other table. */
  internalUserId: string;
};

/**
 * Resolve the caller to both their auth id AND their internal public.users
 * row. Returns null if there is no authenticated user; throws if auth exists
 * but a matching public.users row is missing (which would indicate that the
 * `handle_new_auth_user` trigger is broken — a real bug worth surfacing).
 */
export async function resolveCaller(
  supabase: ReturnType<typeof createSupabaseServerClient>
): Promise<ResolvedCaller | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row, error } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve internal user id: ${error.message}`);
  }
  if (!row?.id) {
    throw new Error(
      "Authenticated user has no matching public.users row. The " +
        "`handle_new_auth_user` trigger may not be installed."
    );
  }
  return { authUserId: user.id, internalUserId: row.id };
}

export type PlatformConnectionRow = {
  platform: PlatformSlug;
  status: "connected" | "disconnected" | "error";
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  encryption_iv: string | null;
  stripe_user_id: string | null;
  square_merchant_id: string | null;
  connected_email: string | null;
  connected_name: string | null;
  token_expires_at: string | null;
  scope: string | null;
  key_hint: string | null;
};

export type DecryptedConnection = {
  platform: PlatformSlug;
  accessToken: string;
  /** Decrypted refresh token, or null if not stored. */
  refreshToken: string | null;
  stripeUserId: string | null;
  squareMerchantId: string | null;
  /** Email address of the connected Google / Microsoft account. */
  connectedEmail: string | null;
  /** Display name of the connected Google / Microsoft account. */
  connectedName: string | null;
  tokenExpiresAt: string | null;
  scope: string | null;
};

/**
 * Load + decrypt the calling user's stored credentials for a given platform.
 * Throws a descriptive error if the user has never connected, if the
 * connection is in `error` status, or if decryption fails (which typically
 * means the master key rotated and the user must reconnect).
 */
export async function loadDecryptedConnection(opts: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  internalUserId: string;
  platform: PlatformSlug;
}): Promise<DecryptedConnection> {
  const { data, error } = await opts.supabase
    .from("platform_connections")
    .select(
      "platform,status,encrypted_access_token,encrypted_refresh_token," +
        "encryption_iv,stripe_user_id,square_merchant_id,connected_email," +
        "connected_name,token_expires_at,scope,key_hint"
    )
    .eq("user_id", opts.internalUserId)
    .eq("platform", opts.platform)
    .maybeSingle<PlatformConnectionRow>();

  if (error) {
    throw new Error(
      `Failed to load ${opts.platform} connection: ${error.message}`
    );
  }
  if (!data) {
    throw new Error(
      `No ${opts.platform} connection on file for this user — connect from the app first.`
    );
  }
  if (data.status !== "connected") {
    throw new Error(
      `${opts.platform} connection is in "${data.status}" state — reconnect to continue.`
    );
  }
  if (!data.encrypted_access_token || !data.encryption_iv) {
    throw new Error(
      `${opts.platform} connection is missing encrypted credentials — reconnect to continue.`
    );
  }

  const accessToken = await decryptToken({
    ciphertext: data.encrypted_access_token,
    iv: data.encryption_iv,
  });

  // Refresh tokens are stored in the bundled "iv:ciphertext" format written
  // by upsertEncryptedConnection — use decryptStoredRefreshToken, NOT the
  // access-token IV (which would be the wrong nonce and cause decryption to fail).
  const refreshToken = await decryptStoredRefreshToken(
    data.encrypted_refresh_token
  );

  return {
    platform: data.platform,
    accessToken,
    refreshToken,
    stripeUserId: data.stripe_user_id,
    squareMerchantId: data.square_merchant_id,
    connectedEmail: data.connected_email,
    connectedName: data.connected_name,
    tokenExpiresAt: data.token_expires_at,
    scope: data.scope,
  };
}

export type UpsertConnectionInput = {
  internalUserId: string;
  platform: PlatformSlug;
  accessToken: string;
  refreshToken?: string | null;
  stripeUserId?: string | null;
  squareMerchantId?: string | null;
  /** Email address for Google / Microsoft connections. */
  connectedEmail?: string | null;
  /** Display name for Google / Microsoft connections. */
  connectedName?: string | null;
  tokenExpiresAt?: string | null;
  scope?: string | null;
};

/**
 * Encrypt fresh OAuth credentials and upsert them onto the user's
 * platform_connections row. Pairs the access and refresh tokens to the same
 * IV — both are sealed under the same AES-GCM key, and we never reuse the
 * IV across (key, plaintext) pairs because every call to encryptToken
 * generates its own.
 *
 * NOTE: AES-GCM mandates unique IVs per (key, message). Because we call
 * encryptToken twice (access + refresh), they get DIFFERENT IVs. We store
 * the access-token IV in encryption_iv, and prepend the refresh-token IV
 * to its ciphertext as `iv:ciphertext` so we can recover it on decrypt.
 */
export async function upsertEncryptedConnection(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  input: UpsertConnectionInput
): Promise<void> {
  const accessEnc = await encryptToken(input.accessToken);

  let refreshCipher: string | null = null;
  if (input.refreshToken) {
    const refreshEnc = await encryptToken(input.refreshToken);
    // Bundle the per-encryption IV with the ciphertext so the access-token
    // IV stored in `encryption_iv` doesn't have to also key the refresh
    // ciphertext (which would be IV reuse — the GCM nonce misuse failure mode).
    refreshCipher = `${refreshEnc.iv}:${refreshEnc.ciphertext}`;
  }

  const { error } = await supabase
    .from("platform_connections")
    .upsert(
      {
        user_id: input.internalUserId,
        platform: input.platform,
        status: "connected",
        encrypted_access_token: accessEnc.ciphertext,
        encrypted_refresh_token: refreshCipher,
        encryption_iv: accessEnc.iv,
        stripe_user_id: input.stripeUserId ?? null,
        square_merchant_id: input.squareMerchantId ?? null,
        connected_email: input.connectedEmail ?? null,
        connected_name: input.connectedName ?? null,
        token_expires_at: input.tokenExpiresAt ?? null,
        scope: input.scope ?? null,
        key_hint: tokenHint(input.accessToken),
        connected_at: new Date().toISOString(),
        error_message: null,
      },
      { onConflict: "user_id,platform" }
    );

  if (error) {
    throw new Error(
      `Failed to persist ${input.platform} connection: ${error.message}`
    );
  }
}

/**
 * Recover the refresh token from the bundled `iv:ciphertext` format written
 * by {@link upsertEncryptedConnection}. Returns null if there is no refresh
 * token stored.
 */
export async function decryptStoredRefreshToken(
  bundled: string | null
): Promise<string | null> {
  if (!bundled) return null;
  const idx = bundled.indexOf(":");
  if (idx < 0) {
    throw new Error(
      "Stored refresh token is not in the expected `iv:ciphertext` format."
    );
  }
  const iv = bundled.slice(0, idx);
  const ciphertext = bundled.slice(idx + 1);
  return decryptToken({ ciphertext, iv } as EncryptedPayload);
}

/**
 * Returns true when the stored access token is expired or will expire within
 * the given buffer (default 5 minutes). A missing expiry is treated as
 * "needs refresh" so callers refresh defensively rather than getting a 401
 * mid-request.
 */
export function tokenNeedsRefresh(
  tokenExpiresAt: string | null,
  bufferMs = 5 * 60 * 1000
): boolean {
  if (!tokenExpiresAt) return true;
  return Date.now() + bufferMs >= new Date(tokenExpiresAt).getTime();
}
