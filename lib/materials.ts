import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchFredSeries, yoyDelta } from "@/lib/fred";

export type TrackingMode = "fred" | "custom";

export type MaterialRow = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  baseline_cost: number;
  tracking_mode: TrackingMode;
  fred_ppi_code: string | null;
  custom_volatility_pct: number | null;
  created_at: string;
};

/**
 * Enriched material row used by the UI — includes the live annualized
 * cost-drift % for whichever tracking mode the material is in.
 */
export type EnrichedMaterial = MaterialRow & {
  /** Annualized cost drift % (FRED YoY or custom volatility). null if FRED unreachable. */
  annualDriftPct: number | null;
};

export async function listMaterials(): Promise<MaterialRow[]> {
  try {
    const supabase = createSupabaseServerClient();
    // Strict RLS ("user owns materials") restricts this SELECT to rows where
    // user_id matches the caller's internal public.users.id. Unauthenticated
    // callers see zero rows (RLS returns an empty result set, not an error).
    // The data ?? [] coalesce + try/catch below handles both that empty path
    // and any unexpected transport-level failures.
    const { data, error } = await supabase
      .from("material_costs")
      .select(
        "id, name, unit, quantity, baseline_cost, tracking_mode, fred_ppi_code, custom_volatility_pct, created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[materials] list error:", error.message);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit ?? "unit",
      quantity: Number(row.quantity ?? 1),
      baseline_cost: Number(row.baseline_cost),
      tracking_mode: ((row.tracking_mode as TrackingMode) ?? "fred"),
      fred_ppi_code: row.fred_ppi_code ?? null,
      custom_volatility_pct:
        row.custom_volatility_pct == null ? null : Number(row.custom_volatility_pct),
      created_at: row.created_at,
    })) as MaterialRow[];
  } catch (err) {
    console.error("[materials] list exception:", err);
    return [];
  }
}

/**
 * Load all materials and resolve their annualized cost-drift %.
 *  - tracking_mode = "fred"   → fetch FRED YoY for the mapped PPI code
 *  - tracking_mode = "custom" → use the user's custom_volatility_pct
 */
export async function loadEnrichedMaterials(): Promise<EnrichedMaterial[]> {
  const rows = await listMaterials();

  const fredCodes = Array.from(
    new Set(
      rows
        .filter((r) => r.tracking_mode === "fred" && r.fred_ppi_code)
        .map((r) => r.fred_ppi_code as string)
    )
  );

  const yoyEntries = await Promise.all(
    fredCodes.map(async (code) => {
      try {
        const series = await fetchFredSeries(code, { limit: 18 });
        return [code, yoyDelta(series.observations)?.deltaPct ?? null] as const;
      } catch {
        return [code, null] as const;
      }
    })
  );
  const yoyMap = new Map(yoyEntries);

  return rows.map((r) => {
    let annualDriftPct: number | null;
    if (r.tracking_mode === "custom") {
      annualDriftPct = r.custom_volatility_pct ?? null;
    } else {
      annualDriftPct = r.fred_ppi_code ? yoyMap.get(r.fred_ppi_code) ?? null : null;
    }
    return { ...r, annualDriftPct };
  });
}
