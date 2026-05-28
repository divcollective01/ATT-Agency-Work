import { encryptToken, decryptToken } from "@/lib/crypto";
import type { PlatformSlug } from "@/lib/platform-connections";

/**
 * Stateless `state` parameter for OAuth round-trips.
 *
 * We sign a small JSON payload `{ uid, ts, nonce, platform }` with the same
 * AES-GCM master key used for token storage, base64url-encode it, and pass
 * it as `?state=...` on the authorize URL. On the callback we decrypt and
 * check (a) the nonce hasn't expired, (b) the embedded auth user matches
 * the still-logged-in caller, and (c) the platform matches the route. This
 * defeats CSRF without needing a session table or cookie.
 *
 * Lifetime: 10 minutes. Real OAuth flows complete in seconds; anything
 * longer almost certainly means the user wandered off mid-flow and the
 * state is stale anyway.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

type StatePayload = {
  uid: string; // auth.users.id
  platform: PlatformSlug;
  ts: number;
  nonce: string;
};

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafe(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64;
}

export async function signOAuthState(input: {
  authUserId: string;
  platform: PlatformSlug;
}): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  const nonceHex = Array.from(nonce)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const payload: StatePayload = {
    uid: input.authUserId,
    platform: input.platform,
    ts: Date.now(),
    nonce: nonceHex,
  };
  const enc = await encryptToken(JSON.stringify(payload));
  // Pack iv + ciphertext into a single token: `iv.ciphertext`, URL-safe.
  return `${toUrlSafe(enc.iv)}.${toUrlSafe(enc.ciphertext)}`;
}

export async function verifyOAuthState(opts: {
  state: string;
  expectedAuthUserId: string;
  expectedPlatform: PlatformSlug;
}): Promise<void> {
  const [ivPart, ctPart] = opts.state.split(".");
  if (!ivPart || !ctPart) {
    throw new Error("Malformed OAuth state token.");
  }
  const json = await decryptToken({
    iv: fromUrlSafe(ivPart),
    ciphertext: fromUrlSafe(ctPart),
  });
  let payload: StatePayload;
  try {
    payload = JSON.parse(json) as StatePayload;
  } catch {
    throw new Error("OAuth state payload is not valid JSON.");
  }
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    throw new Error("OAuth state expired — restart the connection flow.");
  }
  if (payload.uid !== opts.expectedAuthUserId) {
    throw new Error(
      "OAuth state user mismatch — this connect link was issued to a different session."
    );
  }
  if (payload.platform !== opts.expectedPlatform) {
    throw new Error("OAuth state platform mismatch.");
  }
}
