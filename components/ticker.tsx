import { TrendingDown, TrendingUp } from "lucide-react";
import { COMMODITY_CATALOG, fetchFredSeries, yoyDelta } from "@/lib/fred";
import { formatPercent } from "@/lib/utils";

type TickerItem = { label: string; yoy: number };

async function loadItems(): Promise<TickerItem[]> {
  const results = await Promise.all(
    COMMODITY_CATALOG.map(async (c) => {
      try {
        const series = await fetchFredSeries(c.code, { limit: 18 });
        const d = yoyDelta(series.observations)?.deltaPct ?? null;
        return d === null ? null : { label: c.label, yoy: d };
      } catch {
        return null;
      }
    })
  );
  return results.filter((r): r is TickerItem => r !== null);
}

export async function Ticker() {
  const items = await loadItems();
  if (items.length === 0) {
    return (
      <div className="border-b border-cocoa-700 bg-cocoa-900/60 py-2 text-center text-[11px] uppercase tracking-[0.22em] text-cream-mute">
        FRED feed unavailable
      </div>
    );
  }
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden border-b border-cocoa-700 bg-cocoa-900/60">
      <div className="flex gap-10 py-2 animate-ticker whitespace-nowrap">
        {row.map((i, idx) => {
          const up = i.yoy >= 0;
          return (
            <span
              key={idx}
              className="inline-flex items-center gap-2 text-xs text-cream-dim"
            >
              <span className="uppercase tracking-[0.2em] text-cream-mute">{i.label}</span>
              <span
                className={
                  up
                    ? "text-hotpink-soft inline-flex items-center gap-1"
                    : "text-electric-soft inline-flex items-center gap-1"
                }
              >
                {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {formatPercent(i.yoy)} YoY
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
