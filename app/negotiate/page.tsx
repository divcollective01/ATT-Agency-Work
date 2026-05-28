import { NegotiationToolScreen } from "@/components/screens/negotiation-tool";
import { loadEnrichedMaterials } from "@/lib/materials";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Screen 06 — Vendor Price Negotiation Tool
 * Route: /negotiate
 *
 * Required env vars for live features:
 *   FRED_API_KEY    St. Louis Fed API key (for live PPI benchmarks)
 *   RESEND_API_KEY  Resend API key — emails sent FROM noreply@attagency.co,
 *                   reply-to set to the authenticated user's email address.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function NegotiatePage() {
  const supabase = createSupabaseServerClient();

  // Fetch materials and the user's profile in parallel
  const [rows, authResult] = await Promise.all([
    loadEnrichedMaterials(),
    supabase.auth.getUser(),
  ]);

  const authUser = authResult.data.user;
  let businessName = "Your Company";
  let userEmail = authUser?.email ?? "";

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
      userEmail={userEmail}
    />
  );
}
