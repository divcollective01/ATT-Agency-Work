const FRED_BASE = "https://api.stlouisfed.org/fred";

export type FredObservation = {
  date: string;
  value: number | null;
};

export type FredSeriesResponse = {
  seriesId: string;
  observations: FredObservation[];
};

export const FRED_SERIES = {
  CPI_ALL: "CPIAUCSL",
  PPI_ALL: "PPIACO",
  PPI_STEEL: "WPU101",
  PPI_LUMBER: "WPU081",
  PPI_ALUMINUM: "WPU102501",
  PPI_FUEL: "WPU057",
  PPI_PLASTIC: "WPU066",
  PPI_CONCRETE: "WPU1333",
  PPI_FREIGHT_TRUCKING: "PCU484111484111",
  PPI_INDUSTRIAL_ELEC: "PCU221122221122",
  PPI_PAPER: "WPU0911"
} as const;

export type FredSeriesKey = keyof typeof FRED_SERIES;

export const COMMODITY_CATALOG: Array<{
  code: string;
  label: string;
  blurb: string;
}> = [
  { code: FRED_SERIES.CPI_ALL, label: "Consumer CPI (All Items)", blurb: "Broad consumer inflation index, all urban consumers" },
  { code: FRED_SERIES.PPI_ALL, label: "Producer PPI (All Commodities)", blurb: "Wholesale price index across all finished goods" },
  { code: FRED_SERIES.PPI_STEEL, label: "Steel & Iron", blurb: "Hot-rolled, cold-rolled, stainless, structural shapes" },
  { code: FRED_SERIES.PPI_ALUMINUM, label: "Aluminum Mill Shapes", blurb: "Sheet, plate, foil, extruded bars and rods" },
  { code: FRED_SERIES.PPI_LUMBER, label: "Lumber & Wood", blurb: "Softwood, hardwood, panels, sawmill products" },
  { code: FRED_SERIES.PPI_FUEL, label: "Fuel & Petroleum", blurb: "Diesel, gasoline, lubricants, refined products" },
  { code: FRED_SERIES.PPI_PLASTIC, label: "Plastics & Resins", blurb: "Thermoplastic resins, films, injection-mold compounds" },
  { code: FRED_SERIES.PPI_CONCRETE, label: "Ready-Mix Concrete", blurb: "Batch-plant concrete, sand, aggregate mixes" },
  { code: FRED_SERIES.PPI_FREIGHT_TRUCKING, label: "Truck Transportation", blurb: "General long-distance and local freight trucking" },
  { code: FRED_SERIES.PPI_INDUSTRIAL_ELEC, label: "Industrial Electricity", blurb: "Commercial and industrial electric power rates" },
  { code: FRED_SERIES.PPI_PAPER, label: "Paper & Packaging", blurb: "Cardboard, kraft liner, corrugated containers" }
];

export async function fetchFredSeries(
  seriesId: string,
  opts: { limit?: number; observationStart?: string } = {}
): Promise<FredSeriesResponse> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY missing");

  const url = new URL(`${FRED_BASE}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  if (opts.observationStart) url.searchParams.set("observation_start", opts.observationStart);

  const res = await fetch(url.toString(), { next: { revalidate: 60 * 60 * 6 } });
  if (!res.ok) throw new Error(`FRED error ${res.status}`);

  const raw = (await res.json()) as { observations: Array<{ date: string; value: string }> };
  const observations = raw.observations.map((o) => ({
    date: o.date,
    value: o.value === "." ? null : Number(o.value)
  }));

  return { seriesId, observations };
}

export function yoyDelta(observations: FredObservation[]) {
  const latest = observations.find((o) => o.value !== null);
  if (!latest || latest.value === null) return null;
  const yearAgoTarget = new Date(latest.date);
  yearAgoTarget.setFullYear(yearAgoTarget.getFullYear() - 1);
  const yearAgo = observations.find(
    (o) => o.value !== null && new Date(o.date) <= yearAgoTarget
  );
  if (!yearAgo || yearAgo.value === null) return null;
  return {
    latestDate: latest.date,
    latestValue: latest.value,
    yearAgoDate: yearAgo.date,
    yearAgoValue: yearAgo.value,
    deltaPct: ((latest.value - yearAgo.value) / yearAgo.value) * 100
  };
}
