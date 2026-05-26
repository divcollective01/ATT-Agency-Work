"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calculator, Boxes } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DirectiveBanner } from "@/components/directive-banner";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  materialsForecastAt,
  materialsForecastCurve,
  computeBlendedAnnualDriftPct,
  computeCogs,
  buildMaterialsDirective,
  applyForecastToInputs,
  type ForecastMaterial,
} from "@/lib/forecast";

// ── Top-level interactive workspace ────────────────────────────────────

export function ForecastWorkspace({ materials }: { materials: ForecastMaterial[] }) {
  const [marginPct, setMarginPct] = useState<number>(30);

  const hasMaterials = materials.length > 0 && computeCogs(materials) > 0;
  const annualDrift = useMemo(() => computeBlendedAnnualDriftPct(materials), [materials]);

  const horizons = useMemo(
    () =>
      hasMaterials
        ? [30, 60, 90].map((d) =>
            materialsForecastAt({ materials, marginPct, horizonDays: d })
          )
        : [],
    [materials, marginPct, hasMaterials]
  );

  const curve = useMemo(
    () => (hasMaterials ? materialsForecastCurve(materials, marginPct) : []),
    [materials, marginPct, hasMaterials]
  );

  const directive = useMemo(
    () => buildMaterialsDirective({ materials, marginPct }),
    [materials, marginPct]
  );

  const f90 = horizons[2];

  return (
    <div className="space-y-10">
      {/* Margin control */}
      <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div className="max-w-xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-vibrant">
            Margin Target
          </p>
          <h3 className="font-display text-2xl mt-2 tracking-tight">
            Desired Gross Profit Margin
          </h3>
          <p className="text-sm text-cream-mute mt-1">
            Drives every projected revenue figure on this screen. Forecast pulls cost from
            your actual Materials list and computes the revenue needed to hold this margin.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={99}
            step={0.5}
            value={marginPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setMarginPct(Math.min(Math.max(v, 0), 99));
            }}
            className="w-32 text-2xl font-display"
          />
          <span className="font-display text-3xl text-vibrant">%</span>
        </div>
      </div>

      <DirectiveBanner message={directive.message} />

      {/* No materials → friendly nudge */}
      {!hasMaterials && (
        <EmptyState
          icon={<Boxes className="size-6" />}
          title="No materials to project from"
          body="Add at least one material with a baseline cost and quantity in the Materials screen. The forecast engine derives COGS, drift, and required revenue directly from those inputs."
          className="min-h-[200px] justify-center"
        />
      )}

      {hasMaterials && (
        <>
          {/* 30 / 60 / 90 horizon cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {horizons.map((h) => (
              <article
                key={h.horizonDays}
                className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card relative overflow-hidden"
              >
                <div className="absolute -top-12 -right-10 size-36 rounded-full bg-jackson/20 blur-2xl" />
                <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute relative">
                  In {h.horizonDays} days
                </p>
                <p className="font-display text-5xl mt-3 relative">
                  {formatCurrency(h.projectedCogs)}
                </p>
                <p className="text-sm mt-2 relative">
                  <span className="text-hotpink-soft">
                    +{formatCurrency(h.cogsDelta)}
                  </span>{" "}
                  <span className="text-cream-mute">
                    ({formatPercent(h.driftPct)} drift)
                  </span>
                </p>
                <div className="hairline-divider my-4 relative" />
                <dl className="space-y-2 text-sm relative">
                  <div className="flex justify-between">
                    <dt className="text-cream-mute">Revenue (to hold margin)</dt>
                    <dd className="text-cream font-medium">
                      {formatCurrency(h.requiredRevenue)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-cream-mute">Margin if held</dt>
                    <dd className="text-hotpink-soft font-medium">
                      {h.marginIfHeldPct.toFixed(2)}%
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-cream-mute">Required price lift</dt>
                    <dd className="text-vibrant font-semibold">
                      {formatPercent(h.requiredPriceLiftPct)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {/* Curve + line-item calculator */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Projected COGS vs required revenue</CardTitle>
                    <CardDescription>
                      Blended {formatPercent(annualDrift)} annualized drift across your
                      tracked materials. Revenue scales by (1 + drift) to preserve the
                      margin ratio.
                    </CardDescription>
                  </div>
                  <Badge tone="vibrant">90-day horizon</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ForecastChart data={curve} />
              </CardContent>
            </Card>

            <div className="lg:col-span-2">
              <PriceCalculator
                marginPct={marginPct}
                blendedAnnualDriftPct={annualDrift}
              />
            </div>
          </div>

          {/* Math explainer */}
          {f90 && (
            <Card>
              <CardHeader>
                <CardTitle>The math behind the directive</CardTitle>
                <CardDescription>
                  Every number above is derived from your Materials list and the margin %
                  above.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <li className="rounded-2xl border border-cocoa-700 bg-cocoa-950/60 p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">
                      Baseline (today)
                    </p>
                    <p className="font-display text-3xl mt-1">
                      {formatCurrency(f90.cogs)}
                    </p>
                    <p className="text-cream-mute mt-2">
                      COGS = sum(baseline × qty) across {materials.length} material
                      {materials.length === 1 ? "" : "s"}. Revenue at {marginPct}% margin
                      = {formatCurrency(f90.revenue)}.
                    </p>
                  </li>
                  <li className="rounded-2xl border border-cocoa-700 bg-cocoa-950/60 p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">
                      In 90 days, no price action
                    </p>
                    <p className="font-display text-3xl mt-1 text-hotpink-soft">
                      {f90.marginIfHeldPct.toFixed(2)}% margin
                    </p>
                    <p className="text-cream-mute mt-2">
                      COGS rises to {formatCurrency(f90.projectedCogs)} while revenue is
                      held flat.
                    </p>
                  </li>
                  <li className="rounded-2xl border border-vibrant/40 bg-vibrant/5 p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-vibrant">
                      Fix
                    </p>
                    <p className="font-display text-3xl mt-1">
                      +{f90.requiredPriceLiftPct.toFixed(2)}% revenue lift
                    </p>
                    <p className="text-cream-mute mt-2">
                      Required revenue = {formatCurrency(f90.requiredRevenue)}. Scaling
                      both COGS and revenue by (1 + drift) holds the margin ratio.
                    </p>
                  </li>
                  <li className="rounded-2xl border border-cocoa-700 bg-cocoa-950/60 p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">
                      Margin decay if held
                    </p>
                    <p className="font-display text-3xl mt-1">
                      −{f90.marginDecayPp.toFixed(2)} pp
                    </p>
                    <p className="text-cream-mute mt-2">
                      Decay = drift × (1 − target margin) ={" "}
                      {f90.driftPct.toFixed(2)}% × {(1 - marginPct / 100).toFixed(2)}.
                    </p>
                  </li>
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Curve chart ────────────────────────────────────────────────────────

export type ForecastPoint = {
  day: number;
  cogs: number;
  projectedCogs: number;
  revenue: number;
  requiredRevenue: number;
};

export function ForecastChart({ data }: { data: ForecastPoint[] }) {
  return (
    <div className="h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id="proj" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#A855F7" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2E6CF6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#2E6CF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#3D2B22" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="day"
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(d) => (d === 0 ? "today" : `+${d}d`)}
          />
          <YAxis
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
          />
          <Tooltip
            contentStyle={{
              background: "#241813",
              border: "1px solid #3D2B22",
              borderRadius: 16,
              color: "#F5E9D7",
            }}
            formatter={(v: number) => formatCurrency(v)}
            labelFormatter={(d) => (d === 0 ? "Today" : `Day +${d}`)}
          />
          <Legend wrapperStyle={{ color: "#A8927A", fontSize: 12 }} />
          <ReferenceLine x={30} stroke="#3F38B5" strokeDasharray="2 4" />
          <ReferenceLine x={60} stroke="#3F38B5" strokeDasharray="2 4" />
          <ReferenceLine x={90} stroke="#3F38B5" strokeDasharray="2 4" />
          <Area
            type="monotone"
            dataKey="requiredRevenue"
            name="Required revenue"
            stroke="#2E6CF6"
            fill="url(#rev)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="projectedCogs"
            name="Projected COGS"
            stroke="#A855F7"
            fill="url(#proj)"
            strokeWidth={3}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Per-SKU price calculator ───────────────────────────────────────────

function PriceCalculator({
  marginPct,
  blendedAnnualDriftPct,
}: {
  marginPct: number;
  blendedAnnualDriftPct: number;
}) {
  const [unitPrice, setUnitPrice] = useState(100);
  const [unitCost, setUnitCost] = useState(80);
  const [horizon, setHorizon] = useState<30 | 60 | 90>(90);

  const result = useMemo(
    () =>
      applyForecastToInputs({
        currentUnitPrice: unitPrice,
        currentUnitCost: unitCost,
        horizonDays: horizon,
        blendedAnnualDriftPct,
        marginPct,
      }),
    [unitPrice, unitCost, horizon, blendedAnnualDriftPct, marginPct]
  );

  return (
    <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-7 shadow-card">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-2xl bg-electric/20 text-electric-soft flex items-center justify-center">
          <Calculator className="size-5" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">
            Per-SKU Calculator
          </p>
          <h3 className="font-display text-2xl tracking-tight">Hold your margin.</h3>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Current unit price</Label>
          <Input
            type="number"
            min={0}
            value={unitPrice}
            onChange={(e) => setUnitPrice(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Current unit cost</Label>
          <Input
            type="number"
            min={0}
            value={unitCost}
            onChange={(e) => setUnitCost(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label>Forecast horizon</Label>
        <Select
          value={String(horizon)}
          onChange={(e) => setHorizon(Number(e.target.value) as 30 | 60 | 90)}
        >
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </Select>
      </div>

      <div className="hairline-divider my-6" />

      <dl className="space-y-3 text-sm">
        <Row label="Projected cost drift" value={formatPercent(result.driftPct)} />
        <Row
          label="Projected unit cost"
          value={`${formatCurrency(result.projectedUnitCost)}  (+${formatCurrency(
            result.projectedUnitCostIncrease
          )})`}
        />
        <Row
          label="Current margin"
          value={`${result.currentMarginPct.toFixed(1)}%`}
        />
        <Row
          label="Margin if price held"
          value={`${result.marginIfHeldPct.toFixed(1)}%  (−${result.marginDecayPp.toFixed(
            1
          )} pp)`}
          tone="warn"
        />
      </dl>

      <div className="mt-6 rounded-2xl border border-vibrant/40 bg-vibrant/5 p-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-vibrant">
          Required price action
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-cream-mute">New unit price</p>
            <p className="font-display text-3xl mt-1">
              {formatCurrency(result.requiredUnitPrice)}
            </p>
          </div>
          <div>
            <p className="text-xs text-cream-mute">Required lift</p>
            <p className="font-display text-3xl mt-1 text-vibrant">
              {formatPercent(result.requiredPriceLiftPct)}
            </p>
          </div>
        </div>
        <p className="text-xs text-cream-mute mt-3">
          The required price lift equals the projected cost drift exactly. Scaling both
          price and cost by the same factor preserves the margin ratio.
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-cream-mute">{label}</dt>
      <dd
        className={
          tone === "warn"
            ? "text-hotpink-soft font-medium"
            : "text-cream font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}
