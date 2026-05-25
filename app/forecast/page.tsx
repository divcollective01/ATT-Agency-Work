import { ScreenHeader } from "@/components/screen-header";
import { ForecastWorkspace } from "@/components/screens/forecast-charts";
import { COPY } from "@/lib/copy";
import { loadEnrichedMaterials } from "@/lib/materials";
import type { ForecastMaterial } from "@/lib/forecast";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const rows = await loadEnrichedMaterials();

  const materials: ForecastMaterial[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    baseline_cost: r.baseline_cost,
    annualDriftPct: r.annualDriftPct,
  }));

  return (
    <div className="space-y-10">
      <ScreenHeader
        eyebrow={COPY.forecast.eyebrow}
        headline={COPY.forecast.headline}
        sub={COPY.forecast.sub}
      />
      <ForecastWorkspace materials={materials} />
    </div>
  );
}
