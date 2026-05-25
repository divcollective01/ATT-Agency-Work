"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { COMMODITY_CATALOG } from "@/lib/fred";
import { COPY } from "@/lib/copy";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { Boxes, Plus, Trash2, Activity, Sliders } from "lucide-react";
import { createMaterial, deleteMaterial } from "@/app/materials/actions";

export type TrackedMaterial = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  baseline_cost: number;
  tracking_mode: "fred" | "custom";
  fred_ppi_code: string | null;
  custom_volatility_pct: number | null;
  annualDriftPct: number | null;
};

export function MaterialTracker({ materials }: { materials: TrackedMaterial[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"fred" | "custom">("fred");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("tracking_mode", mode);
    startTransition(async () => {
      const res = await createMaterial(fd);
      if (!res.ok) {
        setError(res.error);
      } else {
        setError(null);
        formRef.current?.reset();
      }
    });
  }

  function handleDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      const res = await deleteMaterial(id);
      setDeletingId(null);
      if (!res.ok) setError(res.error);
    });
  }

  const blendedExposure = materials.reduce((sum, m) => {
    if (m.annualDriftPct === null) return sum;
    return sum + m.baseline_cost * m.quantity * (m.annualDriftPct / 100);
  }, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <aside className="lg:col-span-2 rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-7 shadow-card">
        <p className="text-[11px] uppercase tracking-[0.22em] text-vibrant">Add a material</p>
        <h3 className="font-display text-3xl mt-3 leading-tight">
          What goes into your product?
        </h3>
        <p className="text-sm text-cream-mute mt-2">
          Map it to a FRED Producer Price Index, or set a custom annual cost volatility
          if the macro feed doesn&apos;t fit your supplier.
        </p>

        <form ref={formRef} onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Material name</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. Stainless Steel"
              required
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="baseline_cost">Baseline cost</Label>
              <Input
                id="baseline_cost"
                name="baseline_cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Qty / product</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="0"
                step="0.01"
                placeholder="1"
                defaultValue={1}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                name="unit"
                placeholder="kg, lb…"
                maxLength={40}
              />
            </div>
          </div>

          {/* Tracking-mode toggle */}
          <div className="space-y-2">
            <Label>Tracking method</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("fred")}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  mode === "fred"
                    ? "border-vibrant bg-vibrant/10 text-cream"
                    : "border-cocoa-600 bg-cocoa-900 text-cream-mute hover:bg-cocoa-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Activity className="size-4" />
                  <span className="text-sm font-semibold">Macro Index</span>
                </div>
                <p className="text-[11px] mt-1 leading-snug">
                  Live FRED PPI feed.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode("custom")}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  mode === "custom"
                    ? "border-vibrant bg-vibrant/10 text-cream"
                    : "border-cocoa-600 bg-cocoa-900 text-cream-mute hover:bg-cocoa-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sliders className="size-4" />
                  <span className="text-sm font-semibold">Custom Pricing</span>
                </div>
                <p className="text-[11px] mt-1 leading-snug">
                  Manual volatility %.
                </p>
              </button>
            </div>
          </div>

          {mode === "fred" ? (
            <div className="space-y-2">
              <Label htmlFor="fred_ppi_code">FRED PPI commodity</Label>
              <Select
                id="fred_ppi_code"
                name="fred_ppi_code"
                defaultValue={COMMODITY_CATALOG[0].code}
              >
                {COMMODITY_CATALOG.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} — {c.code}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-cream-mute">
                Choose the commodity stream that best matches this material.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="custom_volatility_pct">
                Projected annual cost volatility (%)
              </Label>
              <Input
                id="custom_volatility_pct"
                name="custom_volatility_pct"
                type="number"
                step="0.1"
                placeholder="e.g. 2.5"
                required={mode === "custom"}
              />
              <p className="text-xs text-cream-mute">
                Expected annual % change in this material&apos;s price. Used to project
                forward without needing FRED.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-hotpink-soft border border-hotpink/40 bg-hotpink/10 rounded-2xl px-4 py-3">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full" size="lg">
            <Plus className="size-4" />
            {pending
              ? "Saving…"
              : materials.length === 0
              ? COPY.materials.addCta
              : COPY.materials.addAnother}
          </Button>
        </form>

        {materials.length > 0 && (
          <>
            <div className="hairline-divider my-7" />
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">
                Blended annual exposure
              </p>
              <p className="font-display text-4xl mt-2">
                {blendedExposure >= 0 ? "+" : ""}
                {formatCurrency(blendedExposure)}
                <span className="text-base text-cream-mute"> / product</span>
              </p>
              <p className="text-xs text-cream-mute mt-2">
                Sum of (baseline × quantity × annual drift %) across tracked materials.
              </p>
            </div>
          </>
        )}
      </aside>

      <div className="lg:col-span-3 space-y-4">
        {materials.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-6" />}
            title={COPY.materials.emptyTitle}
            body={COPY.materials.emptyBody}
            className="min-h-[420px] justify-center"
          />
        ) : (
          materials.map((m) => {
            const drift = m.annualDriftPct;
            const dollarHit =
              drift === null
                ? null
                : m.baseline_cost * m.quantity * (drift / 100);
            const commodity =
              m.tracking_mode === "fred" && m.fred_ppi_code
                ? COMMODITY_CATALOG.find((c) => c.code === m.fred_ppi_code)
                : null;
            const up = drift !== null && drift > 0;
            const isDeleting = deletingId === m.id && pending;

            return (
              <article
                key={m.id}
                className="group rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card hover:border-vibrant/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h4 className="font-display text-2xl tracking-tight">{m.name}</h4>
                      {m.tracking_mode === "fred" && m.fred_ppi_code ? (
                        <Badge tone="outline">{m.fred_ppi_code}</Badge>
                      ) : (
                        <Badge tone="vibrant">Custom</Badge>
                      )}
                    </div>
                    <p className="text-sm text-cream-mute mt-1">
                      {commodity?.label ?? "Custom pricing matrix"} — baseline{" "}
                      {formatCurrency(m.baseline_cost)} × {m.quantity}{" "}
                      {m.unit || "unit"}
                    </p>
                  </div>
                  <button
                    className="text-cream-mute hover:text-hotpink p-2 rounded-xl hover:bg-cocoa-800 disabled:opacity-50"
                    onClick={() => handleDelete(m.id)}
                    disabled={isDeleting}
                    aria-label={`Delete ${m.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">
                      Annual drift
                    </p>
                    <p
                      className={`font-display text-3xl mt-1 ${
                        drift === null
                          ? "text-cream-mute"
                          : up
                          ? "text-hotpink-soft"
                          : "text-electric-soft"
                      }`}
                    >
                      {drift === null ? "—" : formatPercent(drift)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">
                      Annual $ impact
                    </p>
                    <p className="font-display text-3xl mt-1">
                      {dollarHit === null
                        ? "—"
                        : `${dollarHit >= 0 ? "+" : ""}${formatCurrency(dollarHit)}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">
                      Source
                    </p>
                    <p className="text-sm text-cream-dim mt-2 leading-snug">
                      {m.tracking_mode === "fred"
                        ? commodity?.blurb ?? "FRED feed"
                        : "User-defined volatility"}
                    </p>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
