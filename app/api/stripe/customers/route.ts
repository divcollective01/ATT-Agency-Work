import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/stripe/customers?query=<optional search>
 *
 * Returns the most recent 25 customers so the Surcharge Hub can offer a
 * picker. If a query is supplied we use Stripe's search API for fuzzy match
 * on name/email; otherwise we list the most recently created.
 */
export async function GET(req: Request) {
  try {
    const stripe = getStripeClient();
    const url = new URL(req.url);
    const query = url.searchParams.get("query")?.trim();

    let customers: Array<{ id: string; name: string | null; email: string | null }> = [];

    if (query) {
      const res = await stripe.customers.search({
        query: `name~"${query.replace(/"/g, '')}" OR email~"${query.replace(/"/g, '')}"`,
        limit: 25,
      });
      customers = res.data.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        email: c.email ?? null,
      }));
    } else {
      const res = await stripe.customers.list({ limit: 25 });
      customers = res.data.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        email: c.email ?? null,
      }));
    }

    return NextResponse.json({ customers });
  } catch (err: any) {
    return NextResponse.json(
      { customers: [], error: err?.message ?? "Failed to list customers" },
      { status: 200 }
    );
  }
}
