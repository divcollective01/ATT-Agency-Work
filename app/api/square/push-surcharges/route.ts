import { NextResponse } from "next/server";
import { squarePushSurcharges, type SquareSurchargeItem } from "@/lib/square";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/square/push-surcharges
 *
 * Body: { locationId, customerId, items: SquareSurchargeItem[] }
 * Creates an Order + draft Invoice in Square. User finalizes from the Square
 * dashboard.
 */
type Body = {
  locationId: string;
  customerId: string;
  items: SquareSurchargeItem[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ pushed: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.locationId) {
    return NextResponse.json({ pushed: false, error: "locationId required" }, { status: 400 });
  }
  if (!body.customerId) {
    return NextResponse.json({ pushed: false, error: "customerId required" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ pushed: false, error: "items required" }, { status: 400 });
  }

  try {
    const result = await squarePushSurcharges({
      locationId: body.locationId,
      customerId: body.customerId,
      items: body.items,
    });
    return NextResponse.json({
      pushed: true,
      orderId: result.orderId,
      invoiceId: result.invoiceId,
      publicUrl: result.publicUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      { pushed: false, error: err?.message ?? "Square push failed" },
      { status: 200 }
    );
  }
}
