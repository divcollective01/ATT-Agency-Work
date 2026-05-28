import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/email/send
 *
 * Body: { to, subject, body, from? }
 *
 * Sends a transactional email via Resend's REST API. We hit the REST endpoint
 * directly instead of the JS SDK because the SDK pulls in @react-email/render
 * (a heavy JSX-rendering dependency) which we don't need for plaintext sends
 * and which inflates the Edge bundle past Cloudflare's limits.
 */
type Body = {
  to: string;
  subject: string;
  body: string;
  from?: string;
};

const DEFAULT_FROM = "Profit Shield <onboarding@resend.dev>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function getKey(): string {
  const key =
    process.env.RESEND_API_KEY ||
    (typeof process !== "undefined" ? process.env.RESEND_API_KEY : undefined);
  if (!key) throw new Error("RESEND_API_KEY missing");
  return key;
}

export async function POST(req: Request) {
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ sent: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.to || !payload.subject || !payload.body) {
    return NextResponse.json(
      { sent: false, error: "to, subject, and body are required" },
      { status: 400 }
    );
  }

  try {
    const key = getKey();
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: payload.from?.trim() || DEFAULT_FROM,
        to: [payload.to],
        subject: payload.subject,
        text: payload.body,
      }),
    });
    const data: any = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { sent: false, error: data?.message ?? `Resend HTTP ${res.status}` },
        { status: 200 }
      );
    }
    return NextResponse.json({ sent: true, id: data?.id ?? null });
  } catch (err: any) {
    return NextResponse.json(
      { sent: false, error: err?.message ?? "Email send failed" },
      { status: 200 }
    );
  }
}
