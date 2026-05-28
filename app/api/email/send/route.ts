import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/email/send
 *
 * Sends a negotiation email on behalf of the authenticated user.
 *
 * - FROM:     "Business Name <noreply@attagency.co>" — verified platform domain
 * - Reply-To: the logged-in user's actual email address (so vendor replies land in their inbox)
 * - The `from` field is intentionally NOT accepted from the client body; the server
 *   always owns the sender address to avoid spoofing and to ensure deliverability.
 *
 * Body: { to, subject, body }
 */
type RequestBody = {
  to: string;
  subject: string;
  body: string;
};

const PLATFORM_FROM_DOMAIN = "attagency.co";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json(
      { sent: false, error: "Not authenticated." },
      { status: 401 }
    );
  }

  // ── User profile (business name for the From header) ───────────────────────
  const { data: userRow } = await supabase
    .from("users")
    .select("business_name")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  const businessName = userRow?.business_name?.trim() || "Profit Shield";
  const replyTo = authUser.email ?? "";

  // ── Parse + validate request body ──────────────────────────────────────────
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

  // ── Resend key ──────────────────────────────────────────────────────────────
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json(
      { sent: false, error: "RESEND_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  try {
    const fromAddress = `${businessName} <noreply@${PLATFORM_FROM_DOMAIN}>`;

    const resendBody: Record<string, unknown> = {
      from: fromAddress,
      to: [to],
      subject,
      text: body,
    };

    // reply_to routes vendor replies back to the actual user's inbox
    if (replyTo) {
      resendBody.reply_to = replyTo;
    }

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });

    const data: { id?: string; message?: string; name?: string } =
      await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { sent: false, error: data?.message ?? `Resend HTTP ${res.status}` },
        { status: 200 }
      );
    }

    return NextResponse.json({ sent: true, id: data?.id ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Email send failed";
    return NextResponse.json({ sent: false, error: msg }, { status: 200 });
  }
}
