"use client";

/**
 * Screen 06 — Usable Yield Tracker
 *
 * Dense data table for tracking stated vs. actual received quantities.
 * Computes effective unit cost and hidden inflation % per delivery.
 *
 * Features:
 *   - Supabase persistence via /api/yield (add / inline-edit / delete)
 *   - Sortable by every column
 *   - Filter by hidden-inflation tier, vendor/material search, date range
 *   - Bulk CSV import with preview + CSV export
 *   - Inline editing (click any cell to edit in place)
 *   - YTD summary KPIs (hidden loss YTD, worst vendor, avg yield loss)
 *   - Color-coded badges: green <2%, yellow 2-8%, red >8% hidden inflation
 *   - Full audit trail in yield_entry_audit table (Supabase trigger)
 *
 * No external API keys required — self-contained computation.
 */

import { useState, useEffect, useCallback, useRef, useId } from "react";
import {
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Info,
  Download,
  Upload,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Pencil,
  Check,
  X,
  Loader2,
  Search,
  Calendar,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/screen-header";
import { COPY } from "@/lib/copy";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface YieldEntry {
  id?: string;
  material: string;
  unit: string;
  invoice_date: string;
  vendor_name: string;
  stated_qty: number;
  actual_qty: number;
  invoiced_unit_cost: number;
  notes?: string;
  // local only
  _localId?: string;
  _saving?: boolean;
}

interface YieldRow extends YieldEntry {
  yield_pct: number;
  effective_cost: number;
  hidden_inflation_pct: number;
  total_invoiced: number;
  hidden_loss: number;
}

type SortKey =
  | "material"
  | "vendor_name"
  | "invoice_date"
  | "stated_qty"
  | "actual_qty"
  | "yield_pct"
  | "invoiced_unit_cost"
  | "effective_cost"
  | "hidden_inflation_pct"
  | "total_invoiced"
  | "hidden_loss";
type SortDir = "asc" | "desc";
type YieldTier = "all" | "good" | "warn" | "danger";

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastMsg {
  id: number;
  type: "success" | "error" | "info";
  text: string;
}

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const counter = useRef(0);
  const toast = useCallback((type: ToastMsg["type"], text: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000
    );
  }, []);
  return { toasts, toast };
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null;
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md",
            t.type === "success" &&
              "border-electric/40 bg-cocoa-900/95 text-electric-soft",
            t.type === "error" &&
              "border-hotpink/40 bg-cocoa-900/95 text-hotpink-soft",
            t.type === "info" &&
              "border-cocoa-600 bg-cocoa-900/95 text-cream-dim"
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeRow(e: YieldEntry): YieldRow {
  const stated = Math.max(e.stated_qty, 0.0001);
  const actual = Math.max(e.actual_qty, 0);
  const yield_pct = (actual / stated) * 100;
  const effective_cost =
    yield_pct > 0 ? (e.invoiced_unit_cost / yield_pct) * 100 : 0;
  const hidden_inflation_pct =
    yield_pct > 0 ? ((100 / yield_pct) - 1) * 100 : 0;
  const total_invoiced = stated * e.invoiced_unit_cost;
  const hidden_loss = (stated - actual) * e.invoiced_unit_cost;
  return {
    ...e,
    yield_pct,
    effective_cost,
    hidden_inflation_pct,
    total_invoiced,
    hidden_loss,
  };
}

function tierOf(hidden_inflation_pct: number): "good" | "warn" | "danger" {
  if (hidden_inflation_pct < 2) return "good";
  if (hidden_inflation_pct <= 8) return "warn";
  return "danger";
}

function YieldBadge({ pct }: { pct: number }) {
  const tier = tierOf(pct);
  const tone =
    tier === "good" ? "electric" : tier === "warn" ? "jackson" : "danger";
  const label = tier === "good" ? "< 2%" : tier === "warn" ? "2–8%" : "> 8%";
  return <Badge tone={tone}>{label}</Badge>;
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (col !== sortKey)
    return <ChevronsUpDown className="size-3 opacity-30" />;
  return sortDir === "asc" ? (
    <ChevronUp className="size-3" />
  ) : (
    <ChevronDown className="size-3" />
  );
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function csvExport(rows: YieldRow[]) {
  const headers = [
    "Material",
    "Vendor",
    "Date",
    "Unit",
    "Stated Qty",
    "Actual Qty",
    "Yield %",
    "Invoiced $/unit",
    "Effective $/unit",
    "Hidden Inflation %",
    "Total Invoiced",
    "Hidden Loss $",
  ];
  const lines = rows.map((r) =>
    [
      `"${r.material}"`,
      `"${r.vendor_name}"`,
      r.invoice_date,
      r.unit,
      r.stated_qty,
      r.actual_qty,
      r.yield_pct.toFixed(2),
      r.invoiced_unit_cost.toFixed(4),
      r.effective_cost.toFixed(4),
      r.hidden_inflation_pct.toFixed(2),
      r.total_invoiced.toFixed(2),
      r.hidden_loss.toFixed(2),
    ].join(",")
  );
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yield-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSVImport(text: string): YieldEntry[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2)
    throw new Error("CSV must have a header row and at least one data row.");
  const headers = lines[0]
    .split(",")
    .map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s\-\/]+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
    );

  const get = (row: string[], key: string) => {
    const idx = headers.indexOf(key);
    return idx >= 0 ? (row[idx] ?? "").trim().replace(/^["']|["']$/g, "") : "";
  };

  return lines
    .slice(1)
    .filter(Boolean)
    .map((line, idx) => {
      const parts = line.split(",");
      const stated = parseFloat(
        get(parts, "stated_qty") || get(parts, "stated")
      );
      const actual = parseFloat(
        get(parts, "actual_qty") || get(parts, "actual")
      );
      const cost = parseFloat(
        get(parts, "invoiced_unit_cost") ||
          get(parts, "unit_cost") ||
          get(parts, "cost")
      );
      if (isNaN(stated) || stated <= 0)
        throw new Error(`Row ${idx + 2}: invalid stated_qty`);
      if (isNaN(actual) || actual < 0)
        throw new Error(`Row ${idx + 2}: invalid actual_qty`);
      if (isNaN(cost) || cost <= 0)
        throw new Error(`Row ${idx + 2}: invalid invoiced_unit_cost`);
      return {
        material: get(parts, "material") || `Item ${idx + 2}`,
        unit: get(parts, "unit") || "unit",
        invoice_date:
          get(parts, "invoice_date") ||
          get(parts, "date") ||
          new Date().toISOString().slice(0, 10),
        vendor_name: get(parts, "vendor_name") || get(parts, "vendor") || "",
        stated_qty: stated,
        actual_qty: actual,
        invoiced_unit_cost: cost,
        notes: get(parts, "notes") || undefined,
        _localId: `csv-${Date.now()}-${idx}`,
      };
    });
}

// ── CSV Import Panel ──────────────────────────────────────────────────────────

function CSVImportPanel({
  onImport,
}: {
  onImport: (rows: YieldEntry[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<YieldEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        setPreview(parseCSVImport(ev.target?.result as string));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Parse error");
        setPreview([]);
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview.length) return;
    setLoading(true);
    try {
      await onImport(preview);
      setOpen(false);
      setPreview([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="size-3.5" />
        Import CSV
      </Button>
    );
  }

  return (
    <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-cream">Bulk CSV import</h3>
          <p className="text-xs text-cream-mute mt-0.5">
            Required:{" "}
            <code className="text-vibrant-soft">
              material, stated_qty, actual_qty, invoiced_unit_cost
            </code>
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-cream-mute hover:text-cream p-1 rounded-lg hover:bg-cocoa-800"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <a
        href="data:text/csv;charset=utf-8,material%2Cvendor_name%2Cinvoice_date%2Cunit%2Cstated_qty%2Cactual_qty%2Cinvoiced_unit_cost%2Cnotes%0ASteel%20Rod%2CApex%20Steel%2C2025-05-15%2Cunit%2C12%2C11.5%2C480%2C"
        download="yield-import-template.csv"
        className="text-xs text-cream-mute hover:text-cream flex items-center gap-1 w-fit transition-colors"
      >
        <Download className="size-3" /> Download template
      </a>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="block w-full text-sm text-cream-mute file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:bg-cocoa-800 file:text-cream hover:file:bg-cocoa-700 cursor-pointer"
        aria-label="Select CSV file"
      />
      {error && (
        <p
          className="rounded-xl border border-hotpink/30 bg-hotpink/10 px-3 py-2 text-xs text-hotpink-soft"
          role="alert"
        >
          {error}
        </p>
      )}
      {preview.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-cream-mute">
            {preview.length} row{preview.length !== 1 ? "s" : ""} parsed:
          </p>
          <div className="rounded-2xl border border-cocoa-700 bg-cocoa-950 overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cocoa-900">
                <tr className="border-b border-cocoa-800">
                  {["Material", "Vendor", "Date", "Stated", "Actual", "$/unit"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2 text-cream-mute font-medium"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-cocoa-800/50">
                    <td className="px-3 py-1.5 text-cream">{row.material}</td>
                    <td className="px-3 py-1.5 text-cream-dim">
                      {row.vendor_name || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-cream-mute">
                      {row.invoice_date}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{row.stated_qty}</td>
                    <td className="px-3 py-1.5 font-mono">{row.actual_qty}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {formatCurrency(row.invoiced_unit_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button size="sm" onClick={handleImport} disabled={loading}>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {loading
              ? "Saving…"
              : `Import ${preview.length} row${preview.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Add-row form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  material: "",
  unit: "",
  invoice_date: new Date().toISOString().slice(0, 10),
  vendor_name: "",
  stated_qty: "",
  actual_qty: "",
  invoiced_unit_cost: "",
  notes: "",
};

function AddRowForm({
  onAdd,
}: {
  onAdd: (entry: YieldEntry) => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const uid = useId();

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const stated = parseFloat(form.stated_qty);
    const actual = parseFloat(form.actual_qty);
    const cost = parseFloat(form.invoiced_unit_cost);
    if (!form.material.trim()) return setError("Material name is required.");
    if (isNaN(stated) || stated <= 0) return setError("Stated qty must be > 0.");
    if (isNaN(actual) || actual < 0)
      return setError("Actual qty must be ≥ 0.");
    if (isNaN(cost) || cost <= 0)
      return setError("Invoiced unit cost must be > 0.");
    setError(null);
    setLoading(true);
    try {
      await onAdd({
        material: form.material.trim(),
        unit: form.unit.trim() || "unit",
        invoice_date: form.invoice_date,
        vendor_name: form.vendor_name.trim(),
        stated_qty: stated,
        actual_qty: actual,
        invoiced_unit_cost: cost,
        notes: form.notes.trim() || undefined,
        _localId: `local-${Date.now()}`,
      });
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setLoading(false);
    }
  }

  const fc =
    "h-9 w-full rounded-xl border border-cocoa-700 bg-cocoa-900 px-3 py-1 text-sm text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant focus:border-vibrant";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card"
    >
      <p className="text-[11px] uppercase tracking-[0.22em] text-vibrant mb-4">
        Add delivery
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="col-span-2 space-y-1">
          <label
            htmlFor={`${uid}-mat`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            Material *
          </label>
          <input
            id={`${uid}-mat`}
            className={fc}
            placeholder="e.g. Steel Rod"
            value={form.material}
            onChange={(e) => set("material", e.target.value)}
            required
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label
            htmlFor={`${uid}-vendor`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            Vendor
          </label>
          <input
            id={`${uid}-vendor`}
            className={fc}
            placeholder="Vendor name"
            value={form.vendor_name}
            onChange={(e) => set("vendor_name", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${uid}-date`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            Invoice date
          </label>
          <input
            id={`${uid}-date`}
            type="date"
            className={fc}
            value={form.invoice_date}
            onChange={(e) => set("invoice_date", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${uid}-unit`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            Unit
          </label>
          <input
            id={`${uid}-unit`}
            className={fc}
            placeholder="unit, lb…"
            value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${uid}-stated`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            Stated qty *
          </label>
          <input
            id={`${uid}-stated`}
            type="number"
            min="0.001"
            step="any"
            className={fc}
            placeholder="100"
            value={form.stated_qty}
            onChange={(e) => set("stated_qty", e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${uid}-actual`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            Actual qty *
          </label>
          <input
            id={`${uid}-actual`}
            type="number"
            min="0"
            step="any"
            className={fc}
            placeholder="97"
            value={form.actual_qty}
            onChange={(e) => set("actual_qty", e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${uid}-cost`}
            className="text-[10px] uppercase tracking-[0.18em] text-cream-mute"
          >
            $/unit *
          </label>
          <input
            id={`${uid}-cost`}
            type="number"
            min="0.0001"
            step="any"
            className={fc}
            placeholder="4.80"
            value={form.invoiced_unit_cost}
            onChange={(e) => set("invoiced_unit_cost", e.target.value)}
            required
          />
        </div>
      </div>
      {error && (
        <p
          className="mt-3 text-xs text-hotpink-soft border border-hotpink/30 bg-hotpink/10 rounded-xl px-3 py-2"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="mt-4">
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {loading ? "Saving…" : "Add row"}
        </Button>
      </div>
    </form>
  );
}

// ── Inline Edit Cell ──────────────────────────────────────────────────────────

function EditCell({
  value,
  type = "text",
  onSave,
}: {
  value: string | number;
  type?: "text" | "number" | "date";
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function save() {
    if (draft.trim() !== String(value)) onSave(draft.trim());
    setEditing(false);
  }

  function cancel() {
    setDraft(String(value));
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          className="w-full rounded-lg border border-vibrant bg-cocoa-950 px-2 py-1 text-xs text-cream focus:outline-none"
          step={type === "number" ? "any" : undefined}
        />
        <button
          onClick={save}
          className="text-electric-soft hover:text-electric p-0.5"
          aria-label="Save"
        >
          <Check className="size-3.5" />
        </button>
        <button
          onClick={cancel}
          className="text-cream-mute hover:text-cream p-0.5"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group/cell flex items-center gap-1 text-left w-full hover:text-cream transition-colors"
      aria-label={`Edit ${value}`}
    >
      <span>{value}</span>
      <Pencil className="size-2.5 opacity-0 group-hover/cell:opacity-50 transition-opacity shrink-0" />
    </button>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export function YieldTrackerScreen() {
  const { toasts, toast } = useToast();
  const [entries, setEntries] = useState<YieldEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("invoice_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Filtering
  const [tierFilter, setTierFilter] = useState<YieldTier>("all");
  const [vendorSearch, setVendorSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Load from Supabase on mount
  useEffect(() => {
    fetch("/api/yield")
      .then((r) => r.json())
      .then((data: { entries?: YieldEntry[] }) => {
        if (data.entries) setEntries(data.entries);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
        toast("error", "Failed to load yield data");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(entry: YieldEntry) {
    const optimistic = { ...entry, _saving: true };
    setEntries((prev) => [optimistic, ...prev]);
    try {
      const res = await fetch("/api/yield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      const data = (await res.json()) as {
        entries?: YieldEntry[];
        error?: string;
      };
      if (!res.ok || !data.entries?.[0]) throw new Error(data.error ?? "Save failed");
      const saved = data.entries[0];
      setEntries((prev) =>
        prev.map((e) =>
          e._localId === entry._localId ? { ...saved, _localId: entry._localId } : e
        )
      );
      toast("success", "Delivery saved");
    } catch (err) {
      setEntries((prev) => prev.filter((e) => e._localId !== entry._localId));
      toast("error", err instanceof Error ? err.message : "Failed to save");
      throw err;
    }
  }

  async function handleImport(rows: YieldEntry[]) {
    setEntries((prev) => [...rows.map((r) => ({ ...r, _saving: true })), ...prev]);
    try {
      const res = await fetch("/api/yield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      });
      const data = (await res.json()) as {
        entries?: YieldEntry[];
        error?: string;
      };
      if (!res.ok || !data.entries) throw new Error(data.error ?? "Import failed");
      setEntries((prev) => {
        const withoutOptimistic = prev.filter(
          (e) => !e._saving || !rows.some((r) => r._localId === e._localId)
        );
        return [...(data.entries ?? []), ...withoutOptimistic];
      });
      toast("success", `${data.entries.length} row${data.entries.length !== 1 ? "s" : ""} imported`);
    } catch (err) {
      setEntries((prev) =>
        prev.filter(
          (e) => !e._saving || !rows.some((r) => r._localId === e._localId)
        )
      );
      toast("error", err instanceof Error ? err.message : "Import failed");
      throw err;
    }
  }

  async function handleDelete(id: string) {
    const entry = entries.find((e) => (e.id ?? e._localId) === id);
    setEntries((prev) => prev.filter((e) => (e.id ?? e._localId) !== id));
    if (!entry?.id) { toast("info", "Entry removed"); return; }
    try {
      const res = await fetch(`/api/yield?id=${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast("info", "Entry deleted");
    } catch {
      setEntries((prev) => [entry, ...prev]);
      toast("error", "Failed to delete entry");
    }
  }

  async function handleEdit(id: string, field: keyof YieldEntry, value: string) {
    const entry = entries.find((e) => (e.id ?? e._localId) === id);
    if (!entry) return;
    const numFields: Array<keyof YieldEntry> = [
      "stated_qty",
      "actual_qty",
      "invoiced_unit_cost",
    ];
    const parsed = numFields.includes(field) ? parseFloat(value) : value;
    if (numFields.includes(field) && (isNaN(parsed as number) || (parsed as number) <= 0))
      return;
    // Optimistic
    setEntries((prev) =>
      prev.map((e) =>
        (e.id ?? e._localId) === id ? { ...e, [field]: parsed } : e
      )
    );
    if (!entry.id) return;
    try {
      const res = await fetch("/api/yield", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, [field]: parsed }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch {
      setEntries((prev) =>
        prev.map((e) => ((e.id ?? e._localId) === id ? entry : e))
      );
      toast("error", "Failed to save edit");
    }
  }

  function handleSort(key: SortKey) {
    setSortDir((prev) =>
      sortKey === key ? (prev === "asc" ? "desc" : "asc") : "desc"
    );
    setSortKey(key);
  }

  const rows = entries.map(computeRow);

  // Filters
  const filtered = rows.filter((r) => {
    if (tierFilter !== "all" && tierOf(r.hidden_inflation_pct) !== tierFilter)
      return false;
    if (
      vendorSearch &&
      !r.vendor_name.toLowerCase().includes(vendorSearch.toLowerCase()) &&
      !r.material.toLowerCase().includes(vendorSearch.toLowerCase())
    )
      return false;
    if (fromDate && r.invoice_date < fromDate) return false;
    if (toDate && r.invoice_date > toDate) return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey as keyof YieldRow];
    const bv = b[sortKey as keyof YieldRow];
    if (av === undefined || bv === undefined) return 0;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  // YTD KPIs
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const ytdRows = rows.filter((r) => r.invoice_date >= ytdStart);
  const ytdHiddenLoss = ytdRows.reduce((s, r) => s + r.hidden_loss, 0);
  const avgYield =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.yield_pct, 0) / rows.length
      : null;
  const avgHidden =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.hidden_inflation_pct, 0) / rows.length
      : null;

  // Worst vendor by total hidden loss
  const vendorLossMap: Record<string, number> = {};
  rows.forEach((r) => {
    const v = r.vendor_name || "Unknown";
    vendorLossMap[v] = (vendorLossMap[v] ?? 0) + r.hidden_loss;
  });
  const worstVendor = Object.entries(vendorLossMap).sort(([, a], [, b]) => b - a)[0];

  const colHd = "px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-cream-mute font-medium cursor-pointer select-none hover:text-cream transition-colors";

  return (
    <div className="space-y-10">
      <ScreenHeader
        eyebrow={COPY.yield.eyebrow}
        headline={COPY.yield.headline}
        sub={COPY.yield.sub}
        trailing={
          sorted.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => csvExport(sorted)}>
              <Download className="size-3.5" />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-5 shadow-card">
          <p className="text-[10px] uppercase tracking-[0.22em] text-cream-mute">Avg yield</p>
          <p
            className={cn(
              "font-display text-3xl mt-2",
              avgYield === null
                ? "text-cream-mute"
                : avgYield >= 98
                ? "text-electric-soft"
                : avgYield >= 92
                ? "text-vibrant-soft"
                : "text-hotpink-soft"
            )}
          >
            {avgYield !== null ? `${avgYield.toFixed(1)}%` : "—"}
          </p>
          <p className="text-[10px] text-cream-mute mt-1">actual ÷ stated</p>
        </div>

        <div className="rounded-3xl border border-hotpink/30 bg-cocoa-900/70 p-5 shadow-card relative overflow-hidden">
          <p className="text-[10px] uppercase tracking-[0.22em] text-cream-mute">Hidden loss YTD</p>
          <p className="font-display text-3xl mt-2 text-hotpink-soft">
            {loaded ? formatCurrency(ytdHiddenLoss) : "—"}
          </p>
          <p className="text-[10px] text-cream-mute mt-1">
            {new Date().getFullYear()} to date
          </p>
        </div>

        <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-5 shadow-card">
          <p className="text-[10px] uppercase tracking-[0.22em] text-cream-mute">Avg hidden inflation</p>
          <p
            className={cn(
              "font-display text-3xl mt-2",
              avgHidden === null
                ? "text-cream-mute"
                : avgHidden > 8
                ? "text-hotpink-soft"
                : avgHidden > 2
                ? "text-vibrant-soft"
                : "text-electric-soft"
            )}
          >
            {avgHidden !== null ? formatPercent(avgHidden) : "—"}
          </p>
          <p className="text-[10px] text-cream-mute mt-1">per-unit real overpay</p>
        </div>

        <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-5 shadow-card">
          <p className="text-[10px] uppercase tracking-[0.22em] text-cream-mute">Worst vendor</p>
          {worstVendor ? (
            <>
              <p className="font-display text-xl mt-2 text-hotpink-soft leading-tight truncate">
                {worstVendor[0]}
              </p>
              <p className="text-[10px] text-cream-mute mt-1">
                {formatCurrency(worstVendor[1])} hidden loss
              </p>
            </>
          ) : (
            <p className="font-display text-3xl mt-2 text-cream-mute">—</p>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs flex-wrap">
        <span className="text-cream-mute flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-electric inline-block" />
          {"<"} 2% — Good
        </span>
        <span className="text-cream-mute flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-vibrant inline-block" />
          2–8% — Watch it
        </span>
        <span className="text-cream-mute flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-hotpink inline-block" />
          {"> 8%"} — Significant
        </span>
        <span className="ml-auto text-cream-mute flex items-center gap-1.5">
          <Info className="size-3.5" />
          Click any value to inline-edit
        </span>
      </div>

      {/* Add form */}
      <AddRowForm onAdd={handleAdd} />

      {/* Import + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <CSVImportPanel onImport={handleImport} />

        <div className="flex items-center gap-1 bg-cocoa-900 border border-cocoa-700 rounded-2xl p-1">
          {(["all", "good", "warn", "danger"] as YieldTier[]).map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-medium transition-colors capitalize",
                tierFilter === t
                  ? "bg-cocoa-700 text-cream"
                  : "text-cream-mute hover:text-cream"
              )}
            >
              {t === "all"
                ? `All (${rows.length})`
                : t === "good"
                ? `< 2% (${rows.filter((r) => tierOf(r.hidden_inflation_pct) === "good").length})`
                : t === "warn"
                ? `2–8% (${rows.filter((r) => tierOf(r.hidden_inflation_pct) === "warn").length})`
                : `> 8% (${rows.filter((r) => tierOf(r.hidden_inflation_pct) === "danger").length})`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative max-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-cream-mute" />
            <input
              type="search"
              placeholder="Vendor / material…"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              className="w-full rounded-xl border border-cocoa-700 bg-cocoa-900 pl-9 pr-3 py-2 text-xs text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant"
              aria-label="Search vendor or material"
            />
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="size-3.5 text-cream-mute shrink-0" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-cocoa-700 bg-cocoa-900 px-2 py-2 text-xs text-cream focus:outline-none focus:ring-1 focus:ring-vibrant w-32"
              aria-label="From date"
            />
            <span className="text-cream-mute text-xs">–</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-xl border border-cocoa-700 bg-cocoa-900 px-2 py-2 text-xs text-cream focus:outline-none focus:ring-1 focus:ring-vibrant w-32"
              aria-label="To date"
            />
          </div>
          {(vendorSearch || fromDate || toDate || tierFilter !== "all") && (
            <button
              onClick={() => {
                setVendorSearch("");
                setFromDate("");
                setToDate("");
                setTierFilter("all");
              }}
              className="text-xs text-cream-mute hover:text-cream flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-cocoa-800"
              aria-label="Clear filters"
            >
              <X className="size-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {!loaded ? (
        <div className="rounded-3xl border border-cocoa-700 p-12 text-center">
          <Loader2 className="size-6 animate-spin text-cream-mute mx-auto" />
          <p className="text-sm text-cream-mute mt-3">Loading deliveries…</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-cocoa-700 p-12 text-center">
          <TrendingDown className="size-8 text-cream-mute mx-auto mb-3 opacity-50" />
          <p className="text-cream-dim font-medium">
            {rows.length === 0
              ? "No deliveries tracked yet."
              : "No deliveries match the current filters."}
          </p>
          <p className="text-sm text-cream-mute mt-1">
            {rows.length === 0
              ? "Add a delivery above or import from CSV."
              : "Try adjusting or clearing the filters."}
          </p>
        </div>
      ) : (
        <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 shadow-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cocoa-800">
                <th
                  className={cn(colHd, "text-left min-w-[160px]")}
                  onClick={() => handleSort("material")}
                >
                  <span className="flex items-center gap-1">
                    Material{" "}
                    <SortIcon
                      col="material"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-left w-24")}
                  onClick={() => handleSort("invoice_date")}
                >
                  <span className="flex items-center gap-1">
                    Date{" "}
                    <SortIcon
                      col="invoice_date"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th className={cn(colHd, "text-left w-16")}>Unit</th>
                <th
                  className={cn(colHd, "text-right w-20")}
                  onClick={() => handleSort("stated_qty")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Stated{" "}
                    <SortIcon
                      col="stated_qty"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-20")}
                  onClick={() => handleSort("actual_qty")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Actual{" "}
                    <SortIcon
                      col="actual_qty"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-20")}
                  onClick={() => handleSort("yield_pct")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Yield%{" "}
                    <SortIcon
                      col="yield_pct"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-28")}
                  onClick={() => handleSort("invoiced_unit_cost")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Invoice $/u{" "}
                    <SortIcon
                      col="invoiced_unit_cost"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-28")}
                  onClick={() => handleSort("effective_cost")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Effective $/u{" "}
                    <SortIcon
                      col="effective_cost"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-28")}
                  onClick={() => handleSort("hidden_inflation_pct")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Hidden %{" "}
                    <SortIcon
                      col="hidden_inflation_pct"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-28")}
                  onClick={() => handleSort("total_invoiced")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Total{" "}
                    <SortIcon
                      col="total_invoiced"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th
                  className={cn(colHd, "text-right w-24")}
                  onClick={() => handleSort("hidden_loss")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Hidden $
                    <SortIcon
                      col="hidden_loss"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </span>
                </th>
                <th className={cn(colHd, "text-center w-20")}>Signal</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const rowId = row.id ?? row._localId ?? "";
                const tier = tierOf(row.hidden_inflation_pct);
                const yc =
                  tier === "good"
                    ? "text-electric-soft"
                    : tier === "warn"
                    ? "text-vibrant-soft"
                    : "text-hotpink-soft";
                const lc =
                  row.hidden_loss > 0.005
                    ? "text-hotpink-soft"
                    : "text-electric-soft";

                return (
                  <tr
                    key={rowId}
                    className={cn(
                      "border-b border-cocoa-800/60 hover:bg-cocoa-900/50 transition-colors",
                      row._saving && "opacity-60"
                    )}
                  >
                    <td className="px-4 py-3">
                      <EditCell
                        value={row.material}
                        onSave={(v) => handleEdit(rowId, "material", v)}
                      />
                      <p className="text-[10px] text-cream-mute mt-0.5">
                        {row.vendor_name || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-cream-dim">
                      <EditCell
                        value={row.invoice_date}
                        type="date"
                        onSave={(v) => handleEdit(rowId, "invoice_date", v)}
                      />
                    </td>
                    <td className="px-4 py-3 text-cream-mute">{row.unit}</td>
                    <td className="px-4 py-3 text-right font-mono text-cream-dim">
                      <EditCell
                        value={row.stated_qty}
                        type="number"
                        onSave={(v) => handleEdit(rowId, "stated_qty", v)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-cream">
                      <EditCell
                        value={row.actual_qty}
                        type="number"
                        onSave={(v) => handleEdit(rowId, "actual_qty", v)}
                      />
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-mono font-semibold",
                        yc
                      )}
                    >
                      <span className="flex items-center justify-end gap-1">
                        {tier === "good" ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {row.yield_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-cream-dim">
                      <EditCell
                        value={row.invoiced_unit_cost}
                        type="number"
                        onSave={(v) =>
                          handleEdit(rowId, "invoiced_unit_cost", v)
                        }
                      />
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-mono font-semibold",
                        yc
                      )}
                    >
                      {formatCurrency(row.effective_cost)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-mono font-semibold",
                        yc
                      )}
                    >
                      {formatPercent(row.hidden_inflation_pct)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-cream-dim">
                      {formatCurrency(row.total_invoiced)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-mono font-bold",
                        lc
                      )}
                    >
                      {row.hidden_loss > 0.005 ? "+" : ""}
                      {formatCurrency(Math.abs(row.hidden_loss))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <YieldBadge pct={row.hidden_inflation_pct} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(rowId)}
                        className="text-cream-mute hover:text-hotpink transition-colors p-1 rounded-lg hover:bg-cocoa-800"
                        aria-label={`Delete ${row.material}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Summary footer */}
            {sorted.length > 1 &&
              (() => {
                const tInv = sorted.reduce((s, r) => s + r.total_invoiced, 0);
                const tLoss = sorted.reduce((s, r) => s + r.hidden_loss, 0);
                const avgY =
                  sorted.reduce((s, r) => s + r.yield_pct, 0) / sorted.length;
                const avgH =
                  sorted.reduce((s, r) => s + r.hidden_inflation_pct, 0) /
                  sorted.length;
                return (
                  <tfoot>
                    <tr className="bg-cocoa-900/60 border-t border-cocoa-700">
                      <td
                        colSpan={3}
                        className="px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-cream-mute"
                      >
                        Totals / averages ({sorted.length} rows)
                      </td>
                      <td colSpan={2} />
                      <td className="px-4 py-3 text-right font-mono font-bold text-cream">
                        {avgY.toFixed(1)}%
                      </td>
                      <td />
                      <td />
                      <td className="px-4 py-3 text-right font-mono font-bold text-cream-mute">
                        {formatPercent(avgH)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-cream">
                        {formatCurrency(tInv)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono font-bold",
                          tLoss > 0 ? "text-hotpink-soft" : "text-electric-soft"
                        )}
                      >
                        {tLoss > 0 ? "+" : ""}
                        {formatCurrency(tLoss)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                );
              })()}
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-cocoa-700 bg-cocoa-900 px-5 py-4 flex items-start gap-3">
        <Info className="size-4 text-cream-mute mt-0.5 shrink-0" />
        <p className="text-xs text-cream-mute leading-relaxed">
          <strong className="text-cream-dim">How it works:</strong> Yield% =
          actual qty ÷ stated qty. Effective $/unit = invoiced $/unit ÷ yield%.
          Hidden inflation = (1 ÷ yield%) − 1. Data is persisted to Supabase
          with a full audit trail. Click any cell to inline-edit. All columns
          are sortable.
        </p>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
