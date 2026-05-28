import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCaller, loadDecryptedConnection } from "@/lib/platform-connections";
import { revokeGoogleToken } from "@/lib/gmail";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/google/disconnect
 *
 * Revokes the stored Google OAuth token (best-effort) and deletes the
 * platform_connections row for the current user. RLS ensures a user can
 * only delete their own row.
 */
export async function POST() {
  const supabase = createSupabaseServerClient();

  let caller: Awaited<ReturnType<typeof resolveCaller>>;
  try {
    caller = await resolveCaller(supabase);
  } catch {
    caller = null;
  }
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Best-effort token revocation — load the token, try to revoke it at Google,
  // then delete the row regardless of revocation outcome.
  try {
    const conn = await loadDecryptedConnection({
      supabase,
      internalUserId: caller.internalUserId,
      platform: "google",
    });
    await revokeGoogleToken(conn.accessToken);
  } catch {
    // Already disconnected or token unreadable — proceed with deletion.
  }

  const { error } = await supabase
    .from("platform_connections")
    .delete()
    .eq("user_id", caller.internalUserId)
    .eq("platform", "google");

  if (error) {
    return NextResponse.json(
      { error: `Failed to disconnect: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
