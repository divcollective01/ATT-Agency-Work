import { NextResponse } from "next/server";
import { squareListCustomers } from "@/lib/square";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/square/customers?query=<optional email/name fragment>
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("query")?.trim() || undefined;
    const customers = await squareListCustomers(query);
    return NextResponse.json({ customers });
  } catch (err: any) {
    return NextResponse.json(
      { customers: [], error: err?.message ?? "Square customer fetch failed" },
      { status: 200 }
    );
  }
}
