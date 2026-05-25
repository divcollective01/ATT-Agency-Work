import { ScreenHeader } from "@/components/screen-header";
import { MaterialTracker, type TrackedMaterial } from "@/components/screens/material-tracker";
import { COPY } from "@/lib/copy";
import { loadEnrichedMaterials } from "@/lib/materials";

export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  const rows = await loadEnrichedMaterials();

  const materials: TrackedMaterial[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    quantity: r.quantity,
    baseline_cost: r.baseline_cost,
    tracking_mode: r.tracking_mode,
    fred_ppi_code: r.fred_ppi_code,
    custom_volatility_pct: r.custom_volatility_pct,
    annualDriftPct: r.annualDriftPct,
  }));

  return (
    <div className="space-y-10">
      <ScreenHeader
        eyebrow={COPY.materials.eyebrow}
        headline={COPY.materials.headline}
        sub={COPY.materials.sub}
      />
      <MaterialTracker materials={materials} />
    </div>
  );
}
