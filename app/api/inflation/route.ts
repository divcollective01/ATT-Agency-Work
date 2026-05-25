import { NextRequest, NextResponse } from "next/server";
import { fetchFredSeries, yoyDelta, FRED_SERIES, type FredSeriesKey } from "@/lib/fred";

export const runtime = "edge";
export const revalidate = 21600;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const seriesParam = searchParams.get("series") ?? "CPI_ALL";
  const codeParam = searchParams.get("code");
  const limit = Number(searchParams.get("limit") ?? 24);

  const seriesId =
    codeParam ??
    (FRED_SERIES[seriesParam as FredSeriesKey] as string | undefined) ??
    FRED_SERIES.CPI_ALL;

  try {
    const result = await fetchFredSeries(seriesId, { limit });
    const delta = yoyDelta(result.observations);

    return NextResponse.json({
      seriesId,
      yoy: delta,
      observations: result.observations,
      verdict: buildVerdict(delta?.deltaPct ?? null)
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FRED fetch failed" },
      { status: 500 }
    );
  }
}

function buildVerdict(deltaPct: number | null) {
  if (deltaPct === null) return "Not enough data to call it yet. Give us a minute.";
  if (deltaPct > 6) return "Wholesale's biting hard. Lock contracts, raise prices, both.";
  if (deltaPct > 3) return "Quiet creep. The kind that eats margin before you notice.";
  if (deltaPct > 0) return "Mild drift. Watchable, not yet a problem.";
  if (deltaPct < -2) return "Catching a break. Sign long-term while the market is generous.";
  return "Flat. Boring. Take the win.";
}
