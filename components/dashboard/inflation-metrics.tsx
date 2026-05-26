"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import {
  runInflationEngine,
  type InflationCategoryMetric,
  type InflationEngineResult,
  type NormalizedTransaction,
} from "@/lib/inflation-engine";

type InflationMetricsProps = {
  transactions: NormalizedTransaction[];
  targetYear: number;
  targetMonth: number;
  defaultInflationRate?: number;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MIN_RATE = 0;
const MAX_RATE = 15;
const DEFAULT_RATE = 3.5;
const STORAGE_KEY = "att_dashboard_inflation_rate";

function safeFloat(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const parsed = Number.parseFloat(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function clampRate(v: number): number {
  if (!Number.isFinite(v)) return MIN_RATE;
  return Math.min(Math.max(v, MIN_RATE), MAX_RATE);
}

function readStoredRate(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return fallback;
    const parsed = safeFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return clampRate(parsed);
  } catch {
    return fallback;
  }
}

function writeStoredRate(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value.toString());
  } catch {
    // ignore quota / disabled-storage failures
  }
}

export function InflationMetrics({
  transactions,
  targetYear,
  targetMonth,
  defaultInflationRate = DEFAULT_RATE,
}: InflationMetricsProps) {
  const initialFallback = clampRate(defaultInflationRate);

  // SSR-safe: server render and first client render both use the fallback
  // value to avoid hydration mismatch. The persisted localStorage value is
  // read inside a useEffect after mount.
  const [rate, setRate] = React.useState<number>(initialFallback);
  const [hydrated, setHydrated] = React.useState<boolean>(false);

  React.useEffect(() => {
    const stored = readStoredRate(initialFallback);
    setRate(stored);
    setHydrated(true);
  }, [initialFallback]);

  // Persist on every change after hydration so refreshes/server restarts
  // never lose the user's tuned inflation target.
  React.useEffect(() => {
    if (!hydrated) return;
    writeStoredRate(rate);
  }, [rate, hydrated]);

  // Cross-tab sync: another tab updating the rate updates this one too.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      const next = clampRate(safeFloat(e.newValue));
      setRate(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commitRate = React.useCallback((next: number) => {
    const clamped = clampRate(next);
    setRate(clamped);
    writeStoredRate(clamped);
  }, []);

  const result = React.useMemo<InflationEngineResult>(
    () =>
      runInflationEngine({
        transactions,
        targetYear,
        targetMonth,
        inflationRate: rate,
      }),
    [transactions, targetYear, targetMonth, rate]
  );

  const sortedMetrics = React.useMemo(() => {
    return [...result.metrics]
      .filter((m) => m.oldTotal > 0 || m.newTotal > 0)
      .sort((a, b) => Math.abs(b.volumeDrift) - Math.abs(a.volumeDrift));
  }, [result.metrics]);

  const currentLabel = `${MONTH_LABELS[targetMonth - 1]} ${targetYear}`;
  const baselineLabel = `${MONTH_LABELS[targetMonth - 1]} ${targetYear - 1}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle>YoY Inflation vs Operational Drift</CardTitle>
            <CardDescription>
              {currentLabel} window compared against {baselineLabel} baseline. Move
              the inflation dial to isolate macro price pressure from real
              purchasing-volume change.
              {result.summary.synthesizedCategoryCount > 0 ? (
                <span className="ml-2 text-jackson-soft">
                  · Sandbox: synthesized baselines for{" "}
                  {result.summary.synthesizedCategoryCount} categor
                  {result.summary.synthesizedCategoryCount === 1 ? "y" : "ies"}.
                </span>
              ) : null}
            </CardDescription>
          </div>
          <RateControl rate={rate} onChange={commitRate} hydrated={hydrated} />
        </div>
        <SummaryStrip summary={result.summary} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-2xl border border-cocoa-700">
          <table className="w-full text-sm">
            <thead className="bg-cocoa-800/60">
              <tr className="text-left text-cream-mute uppercase tracking-[0.14em] text-[10px]">
                <th className="py-3 pl-4 pr-4">Category</th>
                <th className="py-3 pr-4 text-right whitespace-nowrap">
                  {baselineLabel}
                </th>
                <th className="py-3 pr-4 text-right whitespace-nowrap">
                  Infl. Adj. Baseline
                </th>
                <th className="py-3 pr-4 text-right whitespace-nowrap">
                  {currentLabel}
                </th>
                <th className="py-3 pr-4 min-w-[180px]">
                  Inflation vs Volume Mix
                </th>
                <th className="py-3 pr-4 text-right whitespace-nowrap">
                  Volume Drift
                </th>
                <th className="py-3 pr-4 text-right">Signal</th>
              </tr>
            </thead>
            <tbody>
              {sortedMetrics.map((m) => (
                <MetricRow key={m.category} metric={m} />
              ))}
            </tbody>
          </table>
        </div>
        <Legend />
      </CardContent>
    </Card>
  );
}

function RateControl({
  rate,
  onChange,
  hydrated,
}: {
  rate: number;
  onChange: (n: number) => void;
  hydrated: boolean;
}) {
  const [draft, setDraft] = React.useState<string>(rate.toFixed(1));

  React.useEffect(() => {
    setDraft(rate.toFixed(1));
  }, [rate]);

  return (
    <div className="flex flex-col gap-3 md:items-end">
      <div className="flex items-baseline gap-3">
        <span className="text-cream-mute text-[10px] uppercase tracking-[0.14em]">
          Macro Inflation Rate
        </span>
        <span className="font-display text-3xl text-vibrant tabular-nums">
          {rate.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          aria-label="Inflation rate slider"
          min={MIN_RATE}
          max={MAX_RATE}
          step={0.1}
          value={rate}
          onChange={(e) => onChange(safeFloat(e.target.value))}
          className="h-2 w-56 cursor-pointer appearance-none rounded-full bg-cocoa-700 accent-vibrant"
        />
        <Input
          type="number"
          aria-label="Inflation rate input"
          min={MIN_RATE}
          max={MAX_RATE}
          step={0.1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(safeFloat(draft))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onChange(safeFloat(draft));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-10 w-24 text-right"
        />
      </div>
      <div className="flex w-full justify-between text-[10px] text-cream-mute md:w-56">
        <span>{MIN_RATE.toFixed(0)}%</span>
        <span className={cn(hydrated ? "text-electric-soft" : "text-cream-mute")}>
          {hydrated ? "Saved" : "Loading…"}
        </span>
        <span>{MAX_RATE.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function SummaryStrip({
  summary,
}: {
  summary: InflationEngineResult["summary"];
}) {
  const driftTone =
    summary.volumeDrift > 0
      ? "text-hotpink-soft"
      : summary.volumeDrift < 0
        ? "text-electric-soft"
        : "text-cream";

  const tiles: Array<{ label: string; value: string; tone?: string }> = [
    {
      label: "Baseline Spend",
      value: formatCurrency(summary.oldTotal),
    },
    {
      label: "Inflation $ Impact",
      value: formatCurrency(summary.inflationImpact),
      tone: "text-vibrant",
    },
    {
      label: "Adj. Baseline",
      value: formatCurrency(summary.adjustedBaseline),
    },
    {
      label: "Current Spend",
      value: formatCurrency(summary.newTotal),
    },
    {
      label: "Real Volume Drift",
      value: `${summary.volumeDrift > 0 ? "+" : ""}${formatCurrency(summary.volumeDrift)}`,
      tone: driftTone,
    },
  ];

  return (
    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-2xl border border-cocoa-700 bg-cocoa-800/60 px-4 py-3"
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-cream-mute">
            {t.label}
          </div>
          <div
            className={cn(
              "font-display text-xl mt-1 tabular-nums",
              t.tone ?? "text-cream"
            )}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricRow({ metric }: { metric: InflationCategoryMetric }) {
  const hasAnyData = metric.oldTotal > 0 || metric.newTotal > 0;

  return (
    <tr
      className={cn(
        "border-t border-cocoa-700 transition-colors hover:bg-cocoa-800/40",
        !hasAnyData && "opacity-40"
      )}
    >
      <td className="py-3 pl-4 pr-4 font-medium text-cream">
        <div className="flex items-center gap-2">
          <span>{metric.category}</span>
          {metric.synthesizedBaseline ? (
            <span
              className="rounded-full bg-jackson/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-jackson-soft"
              title="Sandbox baseline synthesized at 88% of current spend"
            >
              Synth
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-cream-dim">
        {formatCurrency(metric.oldTotal)}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-cream-mute">
        {metric.hasHistoricalBaseline
          ? formatCurrency(metric.adjustedBaseline)
          : "—"}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-cream">
        {formatCurrency(metric.newTotal)}
      </td>
      <td className="py-3 pr-4">
        <MixBar metric={metric} />
      </td>
      <td className="py-3 pr-4 text-right">
        <DriftCell metric={metric} />
      </td>
      <td className="py-3 pr-4 text-right">
        <SignalBadge metric={metric} />
      </td>
    </tr>
  );
}

function MixBar({ metric }: { metric: InflationCategoryMetric }) {
  if (metric.newTotal <= 0) {
    return (
      <div className="flex w-44 flex-col gap-1">
        <div className="h-2 w-full rounded-full bg-cocoa-700" />
        <div className="text-[10px] text-cream-mute">No current spend</div>
      </div>
    );
  }

  const inflationPct = Math.min(Math.max(metric.inflationShare, 0), 100);
  const operationalPct = Math.min(Math.max(metric.operationalShare, 0), 100);
  const operationalTone =
    metric.volumeDrift >= 0 ? "bg-hotpink" : "bg-electric";

  return (
    <div className="flex w-44 flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-cocoa-700">
        <div
          className="h-full bg-vibrant"
          style={{ width: `${inflationPct}%` }}
          title={`Macro inflation share: ${inflationPct.toFixed(1)}%`}
        />
        <div
          className={cn("h-full", operationalTone)}
          style={{ width: `${operationalPct}%` }}
          title={`Operational volume share: ${operationalPct.toFixed(1)}%`}
        />
      </div>
      <div className="flex justify-between text-[10px] text-cream-mute tabular-nums">
        <span>Infl {inflationPct.toFixed(0)}%</span>
        <span>Vol {operationalPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function DriftCell({ metric }: { metric: InflationCategoryMetric }) {
  const tone =
    metric.status === "spike"
      ? "text-hotpink-soft"
      : metric.status === "optimized"
        ? "text-electric-soft"
        : metric.status === "new"
          ? "text-jackson-soft"
          : "text-cream-mute";

  const sign = metric.volumeDrift > 0 ? "+" : "";

  return (
    <div className={tone}>
      <div className="font-medium tabular-nums">
        {sign}
        {formatCurrency(metric.volumeDrift)}
      </div>
      <div className="text-[10px] text-cream-mute tabular-nums">
        {metric.hasHistoricalBaseline
          ? `${formatPercent(metric.driftPercent)} vs adj.`
          : "no baseline"}
      </div>
    </div>
  );
}

function SignalBadge({ metric }: { metric: InflationCategoryMetric }) {
  if (metric.status === "spike") {
    return <Badge tone="danger">Volume Spike</Badge>;
  }
  if (metric.status === "optimized") {
    return <Badge tone="electric">Optimized</Badge>;
  }
  if (metric.status === "new") {
    return <Badge tone="jackson">New Spend</Badge>;
  }
  return <Badge tone="outline">Flat</Badge>;
}

function Legend() {
  const items = [
    { swatch: "bg-vibrant", label: "Macro inflation share" },
    { swatch: "bg-hotpink", label: "Operational volume — spike" },
    { swatch: "bg-electric", label: "Operational volume — optimized" },
    { swatch: "bg-jackson-soft", label: "Synthesized sandbox baseline" },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-cream-mute">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2">
          <span className={cn("inline-block h-2 w-4 rounded-full", i.swatch)} />
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}
