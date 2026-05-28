import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCaller } from "@/lib/platform-connections";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/microsoft/disconnect
 *
 * Deletes the Microsoft platform_connections row for the current user.
 *
 * Note: Microsoft's token revocation requires an Azure AD admin API call and
 * is not straightforward from a client-side flow. We rely on token expiry and
 * the fact that the refresh token is deleted from our database. The user can
 * also revoke access from their Microsoft account settings at any time.
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

  const { error } = await supabase
    .from("platform_connections")
    .delete()
    .eq("user_id", caller.internalUserId)
    .eq("platform", "microsoft");

  if (error) {
    return NextResponse.json(
      { error: `Failed to disconnect: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
