import { ScreenHeader } from "@/components/screen-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  InflationChart,
  CommodityYoyChart,
  type InflationSeries,
  type CommodityYoY
} from "@/components/screens/inflation-chart";
import { InflationMetricsLive } from "@/components/dashboard/inflation-metrics-live";
import { COPY } from "@/lib/copy";
import { formatPercent } from "@/lib/utils";
import {
  fetchFredSeries,
  yoyDelta,
  FRED_SERIES,
  COMMODITY_CATALOG,
  FredError,
  type FredFailureReason,
} from "@/lib/fred";

export const revalidate = 21600;

function fredCopyFor(reason: FredFailureReason): string {
  switch (reason) {
    case "no_key":
      return "FRED_API_KEY is missing on the server. Set it in Cloudflare Pages → Environment Variables.";
    case "key_rejected":
      return "The FRED API key was rejected. Generate a new one at research.stlouisfed.org/useraccount/apikey.";
    case "upstream_down":
    case "timeout":
      return "Live macro data is temporarily unavailable — the St. Louis Fed's FRED service is returning errors. Charts will return automatically when the feed is restored.";
    default:
      return "Live macro data is temporarily unavailable. The feed will return automatically once the connection recovers.";
  }
}

async function loadMacro(): Promise<{
  chart: InflationSeries[];
  cpiDelta: number | null;
  ppiDelta: number | null;
  available: boolean;
  failureReason: FredFailureReason | null;
}> {
  try {
    // Fetch 36 months so we can compute 24 months of YoY % change
    const [cpi, ppi] = await Promise.all([
      fetchFredSeries(FRED_SERIES.CPI_ALL, { limit: 36 }),
      fetchFredSeries(FRED_SERIES.PPI_ALL, { limit: 36 })
    ]);

    // Build month-keyed maps for 12-month lookback
    const cpiByMonth = new Map(cpi.observations.map((o) => [o.date.slice(0, 7), o.value]));
    const ppiByMonth = new Map(ppi.observations.map((o) => [o.date.slice(0, 7), o.value]));

    // Walk ascending dates, compute YoY % change at each point
    const sortedDates = cpi.observations
      .slice()
      .reverse()
      .map((o) => o.date);

    const chart: InflationSeries[] = [];
    for (const date of sortedDates) {
      const ym = date.slice(0, 7);
      const [year, month] = ym.split("-").map(Number);
      const yearAgoYm = `${year - 1}-${String(month).padStart(2, "0")}`;

      const cpiNow = cpiByMonth.get(ym);
      const cpiAgo = cpiByMonth.get(yearAgoYm);
      const ppiNow = ppiByMonth.get(ym);
      const ppiAgo = ppiByMonth.get(yearAgoYm);

      if (cpiNow != null && cpiAgo != null && cpiAgo !== 0 && ppiNow != null && ppiAgo != null && ppiAgo !== 0) {
        chart.push({
          date: ym,
          cpi: +((((cpiNow - cpiAgo) / cpiAgo) * 100).toFixed(2)),
          ppi: +((((ppiNow - ppiAgo) / ppiAgo) * 100).toFixed(2))
        });
      }
    }

    return {
      chart,
      cpiDelta: yoyDelta(cpi.observations)?.deltaPct ?? null,
      ppiDelta: yoyDelta(ppi.observations)?.deltaPct ?? null,
      available: true,
      failureReason: null,
    };
  } catch (err) {
    const reason: FredFailureReason =
      err instanceof FredError ? err.reason : "other";
    return {
      chart: [],
      cpiDelta: null,
      ppiDelta: null,
      available: false,
      failureReason: reason,
    };
  }
}

async function loadCommodityYoy(): Promise<{
  rows: CommodityYoY[];
  failureReason: FredFailureReason | null;
}> {
  let observedFailure: FredFailureReason | null = null;
  const rows = await Promise.all(
    COMMODITY_CATALOG.map(async (c) => {
      try {
        const series = await fetchFredSeries(c.code, { limit: 18 });
        const delta = yoyDelta(series.observations);
        return { label: c.label, code: c.code, yoyPct: delta?.deltaPct ?? null };
      } catch (err) {
        if (err instanceof FredError && !observedFailure) {
          observedFailure = err.reason;
        }
        return { label: c.label, code: c.code, yoyPct: null };
      }
    })
  );
  rows.sort((a, b) => (b.yoyPct ?? -Infinity) - (a.yoyPct ?? -Infinity));
  return { rows, failureReason: observedFailure };
}

export default async function InflationPage() {
  const [macro, commodityResult] = await Promise.all([
    loadMacro(),
    loadCommodityYoy(),
  ]);
  const commodities = commodityResult.rows;

  return (
    <div className="space-y-10">
      <ScreenHeader
        eyebrow={COPY.inflation.eyebrow}
        headline={COPY.inflation.headline}
        sub={COPY.inflation.sub}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card>
          <CardContent className="p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">CPI YoY</p>
            <p className="font-display text-4xl mt-2">
              {macro.cpiDelta !== null ? formatPercent(macro.cpiDelta) : "—"}
            </p>
            <p className="text-xs text-cream-mute mt-2">
              Consumer Price Index, all urban consumers.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">PPI YoY</p>
            <p className="font-display text-4xl mt-2 text-vibrant">
              {macro.ppiDelta !== null ? formatPercent(macro.ppiDelta) : "—"}
            </p>
            <p className="text-xs text-cream-mute mt-2">
              Producer Price Index, all commodities. Closer to what you actually pay.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">
              Tracked commodities
            </p>
            <p className="font-display text-4xl mt-2">{commodities.length}</p>
            <p className="text-xs text-cream-mute mt-2">
              FRED series feeding the materials and forecast modules.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>CPI vs PPI — Year-over-Year % Change</CardTitle>
              <CardDescription>
                Live from the St. Louis Fed. Both series normalized to YoY % change
                so they sit on the same axis. PPI = cost of making goods; CPI = cost of buying them.
              </CardDescription>
            </div>
            <Badge tone="electric">
              FRED · {FRED_SERIES.CPI_ALL} / {FRED_SERIES.PPI_ALL}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {macro.available && macro.chart.length > 0 ? (
            <InflationChart data={macro.chart} />
          ) : (
            <p className="text-sm text-cream-mute py-12 text-center px-6 max-w-xl mx-auto leading-relaxed">
              {fredCopyFor(macro.failureReason ?? "other")}
            </p>
          )}
        </CardContent>
      </Card>

      <hr className="my-10 border-neutral-800" />

      <InflationMetricsLive />

      <Card>
        <CardHeader>
          <CardTitle>Commodity YoY change</CardTitle>
          <CardDescription>
            Producer prices for the commodity streams you can map materials to. Red bars
            indicate categories where wholesale costs are rising year-over-year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {commodities.some((c) => c.yoyPct !== null) ? (
            <CommodityYoyChart data={commodities} />
          ) : (
            <p className="text-sm text-cream-mute py-12 text-center px-6 max-w-xl mx-auto leading-relaxed">
              {fredCopyFor(commodityResult.failureReason ?? "other")}
            </p>
          )}

          <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
            {commodities.map((c) => (
              <li
                key={c.code}
                className="flex items-center justify-between rounded-2xl border border-cocoa-700 bg-cocoa-900/60 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cream-mute mt-0.5">
                    {c.code}
                  </p>
                </div>
                <span
                  className={
                    c.yoyPct === null
                      ? "text-cream-mute text-sm"
                      : c.yoyPct >= 0
                      ? "text-hotpink-soft font-semibold"
                      : "text-electric-soft font-semibold"
                  }
                >
                  {c.yoyPct === null ? "—" : formatPercent(c.yoyPct)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
