import { NegotiationToolScreen } from "@/components/screens/negotiation-tool";
import { loadEnrichedMaterials } from "@/lib/materials";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Screen 06 — Vendor Price Negotiation Tool
 * Route: /negotiate
 *
 * Server-side data fetched here:
 *   - initialMaterials: tracked material cost rows enriched with live FRED PPI
 *   - businessName:     caller's company name from public.users (for email signature)
 *
 * Required env vars:
 *   FRED_API_KEY    St. Louis Fed (live PPI benchmarks)
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function NegotiatePage() {
  const supabase = createSupabaseServerClient();

  const [rows, authResult] = await Promise.all([
    loadEnrichedMaterials(),
    supabase.auth.getUser(),
  ]);

  const authUser = authResult.data.user;
  let businessName = "Your Company";

  if (authUser) {
    const { data: userRow } = await supabase
      .from("users")
      .select("business_name")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (userRow?.business_name) businessName = userRow.business_name;
  }

  const initialMaterials = rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    quantity: r.quantity,
    baselineCost: r.baseline_cost,
    fredCode: r.fred_ppi_code ?? "",
    fredLabel: r.fred_ppi_code ?? "Custom",
    annualDriftPct: r.annualDriftPct ?? 0,
  }));

  return (
    <NegotiationToolScreen
      initialMaterials={initialMaterials}
      businessName={businessName}
    />
  );
}
