import { NextResponse } from "next/server";
import { squareValidate, squareListLocations } from "@/lib/square";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/square/validate
 *
 * Pings /v2/locations on Square. A non-error response + at least one
 * location means the access token is good and the merchant is set up.
 */
export async function POST() {
  try {
    const { accountName } = await squareValidate();
    const locations = await squareListLocations();
    return NextResponse.json({
      connected: true,
      accountName,
      locations: locations.map((l) => ({ id: l.id, name: l.name })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { connected: false, error: err?.message ?? "Square validation failed" },
      { status: 200 }
    );
  }
}
