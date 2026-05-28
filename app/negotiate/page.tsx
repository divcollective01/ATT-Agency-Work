import { NegotiationToolScreen } from "@/components/screens/negotiation-tool";
import { loadEnrichedMaterials } from "@/lib/materials";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EmailConnectionStatus } from "@/components/screens/negotiation-tool";

/**
 * Screen 06 — Vendor Price Negotiation Tool
 * Route: /negotiate
 *
 * Server-side data fetched here:
 *   - initialMaterials: tracked material cost rows enriched with live FRED PPI
 *   - businessName:     caller's company name from public.users (for email signature)
 *   - userEmail:        caller's auth email (shown in the sender info bar)
 *   - emailConnection:  active Google / Microsoft email connection, if any
 *
 * Required env vars:
 *   FRED_API_KEY          St. Louis Fed (live PPI benchmarks)
 *   RESEND_API_KEY        Not used after Gmail/Outlook OAuth — kept for legacy
 *   GOOGLE_CLIENT_ID      Google Cloud Console OAuth 2.0 client ID
 *   GOOGLE_CLIENT_SECRET  Google Cloud Console OAuth 2.0 client secret
 *   MICROSOFT_CLIENT_ID   Azure Portal app registration client ID
 *   MICROSOFT_CLIENT_SECRET  Azure Portal client secret
 *   NEXT_PUBLIC_APP_URL   External base URL (OAuth redirect URIs)
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function NegotiatePage() {
  const supabase = createSupabaseServerClient();

  // Fetch materials and auth in parallel
  const [rows, authResult] = await Promise.all([
    loadEnrichedMaterials(),
    supabase.auth.getUser(),
  ]);

  const authUser = authResult.data.user;
  let businessName = "Your Company";
  let userEmail = authUser?.email ?? "";
  let internalUserId: string | null = null;

  if (authUser) {
    const { data: userRow } = await supabase
      .from("users")
      .select("id, business_name")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (userRow) {
      internalUserId = userRow.id;
      if (userRow.business_name) businessName = userRow.business_name;
    }
  }

  // ── Email connection status ─────────────────────────────────────────────────
  // Check for an active Google or Microsoft connection (Google preferred).
  let emailConnection: EmailConnectionStatus = {
    platform: null,
    email: null,
    name: null,
  };

  if (internalUserId) {
    const { data: connections } = await supabase
      .from("platform_connections")
      .select("platform, connected_email, connected_name")
      .eq("user_id", internalUserId)
      .eq("status", "connected")
      .in("platform", ["google", "microsoft"]);

    if (connections && connections.length > 0) {
      // Prefer Google if both are connected
      const google = connections.find((c) => c.platform === "google");
      const microsoft = connections.find((c) => c.platform === "microsoft");
      const active = google ?? microsoft;

      if (active?.connected_email) {
        emailConnection = {
          platform: active.platform as "google" | "microsoft",
          email: active.connected_email,
          name: active.connected_name ?? null,
        };
      }
    }
  }

  // ── Materials ───────────────────────────────────────────────────────────────
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
      emailConnection={emailConnection}
    />
  );
}
