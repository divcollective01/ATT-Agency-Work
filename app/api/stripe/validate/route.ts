import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/validate
 *
 * Pings Stripe with the configured secret key. We hit `balance.retrieve()`
 * because it's a single round-trip that proves both auth and read access
 * without needing an account ID parameter. Returns the active currency as a
 * lightweight "what account is this" signal.
 */
export async function POST() {
  try {
    const stripe = getStripeClient();
    const balance = await stripe.balance.retrieve();
    const primaryCurrency =
      balance.available?.[0]?.currency?.toUpperCase() ?? "USD";
    return NextResponse.json({
      connected: true,
      accountName: `Stripe (${primaryCurrency})`,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Stripe validation failed";
    return NextResponse.json(
      { connected: false, error: msg },
      { status: 200 }
    );
  }
}
