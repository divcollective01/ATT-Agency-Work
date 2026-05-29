const FRED_BASE = "https://api.stlouisfed.org/fred";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 400;

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

/**
 * Typed failure surface so callers can distinguish "user needs to fix their
 * key" from "the St. Louis Fed is having a bad day" without string-matching.
 */
export type FredFailureReason =
  | "no_key"        // FRED_API_KEY env var not set
  | "key_rejected"  // FRED returned 400/401/403 — key is invalid or revoked
  | "upstream_down" // 5xx from api.stlouisfed.org
  | "timeout"       // request exceeded FETCH_TIMEOUT_MS
  | "other";

export class FredError extends Error {
  reason: FredFailureReason;
  status: number | null;
  constructor(reason: FredFailureReason, message: string, status: number | null = null) {
    super(message);
    this.name = "FredError";
    this.reason = reason;
    this.status = status;
  }
}

export async function fetchFredSeries(
  seriesId: string,
  opts: { limit?: number; observationStart?: string } = {}
): Promise<FredSeriesResponse> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new FredError("no_key", "FRED_API_KEY is not set on the server.");

  const url = new URL(`${FRED_BASE}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  if (opts.observationStart) url.searchParams.set("observation_start", opts.observationStart);

  let lastError: FredError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        signal: ctrl.signal,
        next: { revalidate: 60 * 60 * 6 },
      });

      // 4xx from FRED means the key or request is bad — retrying won't help.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new FredError(
          "key_rejected",
          `FRED rejected the request (${res.status}) — the API key is invalid or revoked.`,
          res.status
        );
      }

      if (!res.ok) {
        lastError = new FredError(
          "upstream_down",
          `FRED upstream returned ${res.status}.`,
          res.status
        );
        // 5xx → fall through to the retry below
      } else {
        const raw = (await res.json()) as {
          observations: Array<{ date: string; value: string }>;
        };
        const observations = raw.observations.map((o) => ({
          date: o.date,
          value: o.value === "." ? null : Number(o.value),
        }));
        return { seriesId, observations };
      }
    } catch (err) {
      if (err instanceof FredError) {
        if (err.reason === "key_rejected") throw err; // don't retry key errors
        lastError = err;
      } else if (err instanceof Error && err.name === "AbortError") {
        lastError = new FredError(
          "timeout",
          `FRED request timed out after ${FETCH_TIMEOUT_MS}ms.`
        );
      } else {
        lastError = new FredError(
          "other",
          err instanceof Error ? err.message : "Unknown FRED error"
        );
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_BASE_MS * attempt));
    }
  }

  throw lastError ?? new FredError("other", "FRED fetch failed for an unknown reason.");
}

export function yoyDelta(observations: FredObservation[]) {
  const latest = observations.find((o) => o.value !== null);
  if (!latest || latest.value === null) return null;
  const yearAgoTarget = new Date(latest.date);
  yearAgoTarget.setFullYear(yearAgoTarget.getFullYear() - 1);
  const yearAgo = observations.find(
    (o) => o.value !== null && new Date(o.date) <= yearAgoTarget
  );
  if (!yearAgo || yearAgo.value === null || yearAgo.value === 0) return null;
  return {
    latestDate: latest.date,
    latestValue: latest.value,
    yearAgoDate: yearAgo.date,
    yearAgoValue: yearAgo.value,
    deltaPct: ((latest.value - yearAgo.value) / yearAgo.value) * 100
  };
}
