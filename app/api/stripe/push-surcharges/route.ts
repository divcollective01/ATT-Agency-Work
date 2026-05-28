import { NextResponse } from "next/server";
import { getStripeClient, type SurchargeLineItem } from "@/lib/stripe";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/push-surcharges
 *
 * Body: { customerId: string, items: SurchargeLineItem[], createInvoice?: boolean }
 *
 * 1. Creates an Invoice Item on the customer for each surcharge row. Stripe
 *    attaches pending invoice items to the next draft invoice automatically.
 * 2. If `createInvoice` is true (default), we also create a draft invoice
 *    immediately so the user can review/finalize from the Stripe dashboard.
 *
 * Amounts must arrive in the smallest currency unit (cents for USD).
 */
type Body = {
  customerId: string;
  items: SurchargeLineItem[];
  createInvoice?: boolean;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ pushed: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.customerId) {
    return NextResponse.json({ pushed: false, error: "customerId required" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ pushed: false, error: "items required" }, { status: 400 });
  }

  try {
    const stripe = getStripeClient();
    const createdItems = [];
    for (const item of body.items) {
      if (!Number.isFinite(item.amountCents) || item.amountCents <= 0) continue;
      const created = await stripe.invoiceItems.create({
        customer: body.customerId,
        amount: Math.round(item.amountCents),
        currency: item.currency ?? "usd",
        description: item.description,
        metadata: {
          source: "att-profit-shield",
          ...(item.metadata ?? {}),
        },
      });
      createdItems.push({ id: created.id, amount: created.amount, description: created.description });
    }

    let invoice = null;
    if (body.createInvoice !== false) {
      const inv = await stripe.invoices.create({
        customer: body.customerId,
        auto_advance: false,
        collection_method: "send_invoice",
        days_until_due: 30,
        description: "Profit Shield — FRED PPI 90-day exposure surcharge",
      });
      invoice = {
        id: inv.id,
        hostedUrl: inv.hosted_invoice_url,
        status: inv.status,
      };
    }

    return NextResponse.json({
      pushed: true,
      itemsCreated: createdItems.length,
      items: createdItems,
      invoice,
    });
  } catch (err: any) {
    return NextResponse.json(
      { pushed: false, error: err?.message ?? "Stripe push failed" },
      { status: 200 }
    );
  }
}
