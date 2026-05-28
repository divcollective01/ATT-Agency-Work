"use client";

/**
 * Screen 06 — Vendor Price Negotiation Tool
 *
 * Pulls tracked material inputs from Supabase, blends them with live FRED PPI
 * benchmarks, and lets the user enter the actual quoted vendor price increase
 * directly into the row. Overage vs. FRED is computed live.
 *
 * Emails are sent via the user's connected Gmail or Outlook account — no
 * platform domain required. Connect / disconnect buttons live at the top of
 * this screen. Token refresh is handled transparently by /api/email/send.
 */

import { useState, useEffect, useMemo, useRef, useId } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Mail,
  ChevronDown,
  ChevronUp,
  Filter,
  Info,
  Send,
  Loader2,
  Upload,
  Plus,
  X,
  ExternalLink,
  Link2Off,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/screen-header";
import { COPY } from "@/lib/copy";
import { COMMODITY_CATALOG } from "@/lib/fred";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type NegotiationStatus = "flagged" | "in-progress" | "resolved";
type FilterStatus = "all" | NegotiationStatus;

/** Shared with app/negotiate/page.tsx (server component). */
export type EmailConnectionStatus = {
  platform: "google" | "microsoft" | null;
  email: string | null;
  name: string | null;
};

export interface InitialMaterial {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  baselineCost: number;
  fredCode: string;
  fredLabel: string;
  annualDriftPct: number;
}

interface VendorEntry {
  id: string;
  vendorName: string;
  material: string;
  unit: string;
  contactName: string;
  contactEmail: string;
  baselineUnitCost: number;
  quotedUnitCost: number;     // user-entered live quote
  quantity: number;
  fredCode: string;
  fredLabel: string;
  fredPpiYoyPct: number;
  status: NegotiationStatus;
  dateQuoted: string;
}

// ── Computed helpers ───────────────────────────────────────────────────────────

function computeEntry(v: VendorEntry) {
  const baseline = v.baselineUnitCost || 0;
  const quoted = v.quotedUnitCost || 0;
  const vendorChangePct = baseline > 0 ? ((quoted - baseline) / baseline) * 100 : 0;
  const overagePct = vendorChangePct - v.fredPpiYoyPct;
  const baselineTotal = baseline * v.quantity;
  const quotedTotal = quoted * v.quantity;
  const fredJustifiedTotal = baseline * (1 + v.fredPpiYoyPct / 100) * v.quantity;
  const overageTotal = quotedTotal - fredJustifiedTotal;
  return { vendorChangePct, overagePct, baselineTotal, quotedTotal, fredJustifiedTotal, overageTotal };
}

// ── Email draft generator ──────────────────────────────────────────────────────

function generateEmailSubject(v: VendorEntry): string {
  return `Price Increase Discussion — ${v.material}`;
}

function generateEmailBody(
  v: VendorEntry,
  businessName: string,
  senderName?: string | null
): string {
  const c = computeEntry(v);
  const companyName = businessName;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return `Dear ${v.contactName || "[Vendor Contact]"},

Thank you for your continued partnership with ${companyName}. I'm writing regarding the recent pricing update on ${v.material} (quoted on ${new Date(v.dateQuoted).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}).

THE DATA

Your proposed increase: ${formatPercent(c.vendorChangePct, 1)} (from ${formatCurrency(v.baselineUnitCost)}/${v.unit} → ${formatCurrency(v.quotedUnitCost)}/${v.unit})
FRED ${v.fredLabel} YoY change: ${formatPercent(v.fredPpiYoyPct, 1)}
Excess above index: ${formatPercent(c.overagePct, 1)}

At our current order volume of ${v.quantity.toLocaleString()} ${v.unit}s, your quote implies:
  - Quoted total: ${formatCurrency(c.quotedTotal)}
  - Index-justified cost: ${formatCurrency(c.fredJustifiedTotal)} (baseline + FRED ${v.fredLabel})
  - Unexplained overage: ${formatCurrency(c.overageTotal)}

THE ASK

The FRED ${v.fredLabel} — sourced directly from the St. Louis Federal Reserve — indicates ${formatPercent(v.fredPpiYoyPct, 1)} cost movement for this commodity category over the past 12 months. We fully understand that input costs change, and we are prepared to absorb cost increases that track with macro indices.

However, a ${formatPercent(c.vendorChangePct, 1)} increase is ${formatPercent(c.overagePct, 1)} above the published index. We'd like to request that you revisit the pricing to align closer to the index-justified figure of ${formatCurrency(v.baselineUnitCost * (1 + v.fredPpiYoyPct / 100))}/${v.unit}, or provide documentation of additional cost drivers that explain the gap.

We value this supply relationship and want to find a mutually workable arrangement. Could we schedule a brief call this week to discuss?

Best regards,
${senderName ?? "[Your Name]"}
${companyName}

---
Data source: St. Louis Federal Reserve FRED — ${v.fredLabel} (${v.fredCode})
Retrieved: ${today}`;
}

function generateEmailDraft(
  v: VendorEntry,
  businessName: string,
  senderName?: string | null
): string {
  return `Subject: ${generateEmailSubject(v)}\n\n${generateEmailBody(v, businessName, senderName)}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<NegotiationStatus, { label: string; tone: "danger" | "jackson" | "electric"; icon: React.FC<{ className?: string }> }> = {
  flagged: { label: "Flagged", tone: "danger", icon: AlertTriangle },
  "in-progress": { label: "In Progress", tone: "jackson", icon: Clock },
  resolved: { label: "Resolved", tone: "electric", icon: CheckCircle2 },
};

function MathBreakdown({
  vendor,
  onQuotedCostChange,
  onContactNameChange,
  onContactEmailChange,
}: {
  vendor: VendorEntry;
  onQuotedCostChange: (id: string, value: number) => void;
  onContactNameChange: (id: string, value: string) => void;
  onContactEmailChange: (id: string, value: string) => void;
}) {
  const c = computeEntry(vendor);
  const isOverage = c.overagePct > 0;

  return (
    <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Vendor side */}
      <div className="rounded-2xl border border-cocoa-700 bg-cocoa-950 p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-cream-mute mb-3">Vendor quote</p>
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-cream-dim">Baseline unit cost</span>
            <span className="font-mono text-cream">{formatCurrency(vendor.baselineUnitCost)}</span>
          </div>
          {/* Editable quoted price field */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">
              Quoted unit cost (enter live quote)
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={vendor.quotedUnitCost || ""}
              onChange={(e) =>
                onQuotedCostChange(vendor.id, parseFloat(e.target.value) || 0)
              }
              placeholder="0.00"
              className="h-9 w-full rounded-xl border border-cocoa-700 bg-cocoa-900 px-3 py-1 text-sm text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant focus:border-vibrant font-mono"
            />
          </div>
          <div className="flex justify-between text-sm border-t border-cocoa-800 pt-2 mt-2">
            <span className="text-cream-dim">Vendor increase</span>
            <span className="font-mono font-semibold text-hotpink-soft">
              {formatPercent(c.vendorChangePct)} /{" "}
              {formatCurrency(vendor.quotedUnitCost - vendor.baselineUnitCost)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-cream-dim">Quantity × quoted</span>
            <span className="font-mono font-semibold text-cream">{formatCurrency(c.quotedTotal)}</span>
          </div>

          {/* Editable contact fields */}
          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-cocoa-800">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">
                Contact name
              </label>
              <input
                type="text"
                value={vendor.contactName}
                onChange={(e) => onContactNameChange(vendor.id, e.target.value)}
                placeholder="Vendor contact"
                className="h-8 w-full rounded-xl border border-cocoa-700 bg-cocoa-900 px-3 text-xs text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">
                Contact email
              </label>
              <input
                type="email"
                value={vendor.contactEmail}
                onChange={(e) => onContactEmailChange(vendor.id, e.target.value)}
                placeholder="rep@vendor.com"
                className="h-8 w-full rounded-xl border border-cocoa-700 bg-cocoa-900 px-3 text-xs text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant"
              />
            </div>
          </div>
        </div>
      </div>

      {/* FRED benchmark side */}
      <div className="rounded-2xl border border-electric/30 bg-cocoa-950 p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-cream-mute mb-3">
          FRED benchmark — {vendor.fredLabel}
        </p>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-cream-dim">PPI YoY change</span>
            <span className="font-mono text-electric-soft">{formatPercent(vendor.fredPpiYoyPct)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-cream-dim">Index-justified cost</span>
            <span className="font-mono text-cream">
              {formatCurrency(vendor.baselineUnitCost * (1 + vendor.fredPpiYoyPct / 100))}
            </span>
          </div>
          <div className="flex justify-between text-sm border-t border-cocoa-800 pt-2 mt-2">
            <span className="text-cream-dim">Index-justified total</span>
            <span className="font-mono font-semibold text-cream">{formatCurrency(c.fredJustifiedTotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-cream-dim font-semibold">
              {isOverage ? "Unexplained overage" : "Vendor undercharge"}
            </span>
            <span
              className={cn(
                "font-mono font-bold",
                isOverage ? "text-hotpink-soft" : "text-electric-soft"
              )}
            >
              {isOverage ? "+" : ""}{formatCurrency(Math.abs(c.overageTotal))}
            </span>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="md:col-span-2 rounded-2xl border border-cocoa-700 bg-cocoa-900 p-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1">
          <p className="text-xs text-cream-mute">Vendor increase vs. FRED index</p>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-2.5 rounded-full bg-cocoa-800 overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 bg-electric-soft rounded-full"
                style={{
                  width: `${Math.min(
                    c.vendorChangePct !== 0
                      ? (vendor.fredPpiYoyPct / c.vendorChangePct) * 100
                      : 0,
                    100
                  )}%`,
                }}
              />
            </div>
            <span className="text-xs text-electric-soft font-mono whitespace-nowrap">
              FRED {formatPercent(vendor.fredPpiYoyPct)}
            </span>
            <span className="text-xs text-hotpink-soft font-mono whitespace-nowrap">
              Vendor {formatPercent(c.vendorChangePct)}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-cream-mute">Excess</p>
          <p
            className={cn(
              "font-display text-2xl",
              isOverage ? "text-hotpink-soft" : "text-electric-soft"
            )}
          >
            {isOverage ? "+" : ""}
            {formatPercent(c.overagePct)}
          </p>
        </div>
      </div>
    </div>
  );
}

function VendorCard({
  vendor,
  businessName,
  emailConnection,
  onStatusChange,
  onVendorNameChange,
  onQuotedCostChange,
  onContactNameChange,
  onContactEmailChange,
}: {
  vendor: VendorEntry;
  businessName: string;
  emailConnection: EmailConnectionStatus;
  onStatusChange: (id: string, status: NegotiationStatus) => void;
  onVendorNameChange: (id: string, value: string) => void;
  onQuotedCostChange: (id: string, value: number) => void;
  onContactNameChange: (id: string, value: string) => void;
  onContactEmailChange: (id: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const c = computeEntry(vendor);
  const cfg = STATUS_CONFIG[vendor.status];
  const StatusIcon = cfg.icon;
  const isOverage = c.overagePct > 0;
  const hasQuote = vendor.quotedUnitCost > 0;
  const emailConnected = emailConnection.platform !== null;
  const canSend = hasQuote && vendor.contactEmail.trim().length > 0 && emailConnected;
  const senderName = emailConnection.name;
  const providerLabel =
    emailConnection.platform === "google"
      ? "Gmail"
      : emailConnection.platform === "microsoft"
      ? "Outlook"
      : "Email";

  function copyEmail() {
    navigator.clipboard
      .writeText(generateEmailDraft(vendor, businessName, senderName))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
  }

  async function sendEmail() {
    if (!canSend) return;
    setSending(true);
    setSendStatus(null);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: vendor.contactEmail.trim(),
          subject: generateEmailSubject(vendor),
          body: generateEmailBody(vendor, businessName, senderName),
        }),
      });
      const data: {
        sent?: boolean;
        error?: string;
        needsReconnect?: boolean;
        needsConnect?: boolean;
        from?: string;
        provider?: string;
      } = await res.json();

      if (data.sent) {
        setSendStatus({
          ok: true,
          message: `Sent to ${vendor.contactEmail} via ${providerLabel}`,
        });
        onStatusChange(vendor.id, "in-progress");
      } else if (data.needsReconnect) {
        setSendStatus({
          ok: false,
          message: `${data.error ?? "Token expired"} — reconnect from the top of this page.`,
        });
      } else {
        setSendStatus({ ok: false, message: data.error ?? "Send failed" });
      }
    } catch (err: unknown) {
      setSendStatus({
        ok: false,
        message: err instanceof Error ? err.message : "Network error sending email",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <article
      className={cn(
        "rounded-3xl border bg-cocoa-900/70 shadow-card transition-colors",
        !hasQuote
          ? "border-cocoa-700"
          : vendor.status === "flagged" && isOverage
          ? "border-hotpink/30"
          : vendor.status === "in-progress"
          ? "border-jackson/30"
          : "border-cocoa-700"
      )}
    >
      {/* Header row */}
      <div
        className="flex items-start gap-4 p-6 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-display text-xl text-cream">{vendor.material}</h3>
            <Badge tone={hasQuote ? cfg.tone : "neutral"}>
              <StatusIcon className="size-3 mr-1" />
              {hasQuote ? cfg.label : "Awaiting quote"}
            </Badge>
          </div>
          <p className="text-sm text-cream-mute mt-0.5">
            {vendor.vendorName || "Unassigned vendor"} · {vendor.quantity.toLocaleString()} {vendor.unit} · baseline {formatCurrency(vendor.baselineUnitCost)}/{vendor.unit}
          </p>
        </div>

        {/* Quick numbers */}
        <div className="hidden md:flex items-center gap-6 text-right shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Vendor Δ</p>
            <p className="font-mono font-semibold text-hotpink-soft">
              {hasQuote ? formatPercent(c.vendorChangePct) : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">FRED PPI</p>
            <p className="font-mono font-semibold text-electric-soft">
              {formatPercent(vendor.fredPpiYoyPct)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Excess</p>
            <p
              className={cn(
                "font-mono font-bold text-lg",
                hasQuote && isOverage
                  ? "text-hotpink-soft"
                  : hasQuote
                  ? "text-electric-soft"
                  : "text-cream-mute"
              )}
            >
              {hasQuote ? `${isOverage ? "+" : ""}${formatPercent(c.overagePct)}` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Overage $</p>
            <p className="font-mono font-bold text-lg text-cream">
              {hasQuote && isOverage ? formatCurrency(c.overageTotal) : "—"}
            </p>
          </div>
        </div>

        <button className="text-cream-mute p-1 shrink-0">
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-6 pb-6 border-t border-cocoa-800 pt-5">
          {/* Vendor-name input (also editable) */}
          <div className="space-y-1 mb-4">
            <label className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">
              Vendor name
            </label>
            <input
              type="text"
              value={vendor.vendorName}
              onChange={(e) => onVendorNameChange(vendor.id, e.target.value)}
              placeholder="Supplier name"
              className="h-9 w-full max-w-sm rounded-xl border border-cocoa-700 bg-cocoa-900 px-3 py-1 text-sm text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant focus:border-vibrant"
            />
          </div>

          {/* Math breakdown w/ editable quote + contact fields */}
          <MathBreakdown
            vendor={vendor}
            onQuotedCostChange={onQuotedCostChange}
            onContactNameChange={onContactNameChange}
            onContactEmailChange={onContactEmailChange}
          />

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEmail(!showEmail)}
              disabled={!hasQuote}
            >
              <Mail className="size-3.5" />
              {showEmail ? "Hide" : "Draft"} negotiation email
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-cream-mute">Status:</span>
              {(["flagged", "in-progress", "resolved"] as NegotiationStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={(e) => { e.stopPropagation(); onStatusChange(vendor.id, s); }}
                  className={cn(
                    "text-xs rounded-full px-3 py-1 border transition-colors",
                    vendor.status === s
                      ? "bg-cocoa-700 border-cocoa-600 text-cream"
                      : "border-cocoa-700 text-cream-mute hover:text-cream hover:border-cocoa-600"
                  )}
                >
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Email draft */}
          {showEmail && hasQuote && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">
                  Negotiation email draft
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={copyEmail}>
                    <Copy className="size-3.5" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                  <Button
                    variant="electric"
                    size="sm"
                    onClick={sendEmail}
                    disabled={!canSend || sending}
                    title={
                      !emailConnected
                        ? "Connect Gmail or Outlook at the top of this page to send"
                        : !hasQuote
                        ? "Enter a quoted unit cost first"
                        : !vendor.contactEmail.trim()
                        ? "Add a contact email above to send"
                        : undefined
                    }
                  >
                    {sending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    {sending ? "Sending…" : `Send via ${providerLabel}`}
                  </Button>
                </div>
              </div>
              <pre className="rounded-2xl border border-cocoa-700 bg-cocoa-950 px-5 py-4 text-xs text-cream-dim font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto">
                {generateEmailDraft(vendor, businessName, senderName)}
              </pre>
              {sendStatus && (
                <div
                  className={cn(
                    "mt-2 rounded-xl border px-3 py-2 text-xs flex items-start gap-2",
                    sendStatus.ok
                      ? "border-electric/40 bg-electric/10 text-electric-soft"
                      : "border-hotpink/40 bg-hotpink/10 text-hotpink-soft"
                  )}
                >
                  {sendStatus.ok ? (
                    <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-snug">{sendStatus.message}</span>
                </div>
              )}
              <p className="text-xs text-cream-mute mt-2 flex items-center gap-1.5">
                <Info className="size-3.5" />
                {emailConnection.email
                  ? `Sent from ${emailConnection.email} via ${providerLabel}.`
                  : "Connect Gmail or Outlook above to enable sending."}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────


// ── CSV Import ────────────────────────────────────────────────────────────────

function parseVendorCSV(text: string): VendorEntry[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/[\s\-\/]+/g, "_").replace(/[^a-z0-9_]/g, ""));

  const get = (row: string[], key: string): string => {
    const idx2 = headers.indexOf(key);
    return idx2 >= 0 ? (row[idx2] ?? "").trim().replace(/^["']|["']$/g, "") : "";
  };

  return lines.slice(1).filter(Boolean).map((line, idx2) => {
    const parts = line.split(",");
    const baseline = parseFloat(get(parts, "baseline_unit_cost") || get(parts, "baseline"));
    const quoted = parseFloat(get(parts, "quoted_unit_cost") || get(parts, "quoted"));
    if (isNaN(baseline) || baseline <= 0) throw new Error(`Row ${idx2 + 2}: invalid baseline_unit_cost`);
    if (isNaN(quoted) || quoted <= 0) throw new Error(`Row ${idx2 + 2}: invalid quoted_unit_cost`);
    if (quoted <= baseline) throw new Error(`Row ${idx2 + 2}: quoted must exceed baseline`);
    const fredCode = get(parts, "fred_code");
    const fredEntry = COMMODITY_CATALOG.find((c) => c.code === fredCode);
    return {
      id: `csv-${Date.now()}-${idx2}`,
      vendorName: get(parts, "vendor_name") || get(parts, "vendor") || `Vendor ${idx2 + 2}`,
      material: get(parts, "material") || "Unknown",
      unit: get(parts, "unit") || "unit",
      contactName: get(parts, "contact_name") || "",
      contactEmail: get(parts, "contact_email") || "",
      baselineUnitCost: baseline,
      quotedUnitCost: quoted,
      quantity: parseFloat(get(parts, "quantity")) || 1,
      fredCode,
      fredLabel: fredEntry?.label ?? fredCode,
      fredPpiYoyPct: parseFloat(get(parts, "fred_ppi_yoy_pct")) || 0,
      status: "flagged" as NegotiationStatus,
      dateQuoted: get(parts, "date_quoted") || get(parts, "date") || new Date().toISOString().slice(0, 10),
    };
  });
}

function CSVImportPanel({ onImport }: { onImport: (rows: VendorEntry[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VendorEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { setPreview(parseVendorCSV(ev.target?.result as string)); }
      catch (err) { setError(err instanceof Error ? err.message : "Parse error"); setPreview([]); }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview.length) return;
    setLoading(true);
    try {
      await onImport(preview);
      setOpen(false); setPreview([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setLoading(false); }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="size-3.5" />Import CSV
      </Button>
    );
  }

  return (
    <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-cream">Bulk CSV import</h3>
          <p className="text-xs text-cream-mute mt-0.5">
            Required columns: <code className="text-vibrant-soft">vendor_name, material, baseline_unit_cost, quoted_unit_cost, fred_code</code>
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-cream-mute hover:text-cream p-1 rounded-lg hover:bg-cocoa-800" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <a
        href="data:text/csv;charset=utf-8,vendor_name%2Cmaterial%2Cunit%2Ccontact_name%2Ccontact_email%2Cbaseline_unit_cost%2Cquoted_unit_cost%2Cquantity%2Cfred_code%2Cdate_quoted%0AApex%20Steel%2CSteel%20Rod%2Cunit%2CMarcus%20Webb%2Cmwebb%40vendor.com%2C480%2C522%2C12%2CWPU101%2C2025-05-15"
        download="vendor-quotes-template.csv"
        className="text-xs text-cream-mute hover:text-cream flex items-center gap-1 w-fit"
      >
        <ExternalLink className="size-3" /> Download template
      </a>
      <input
        ref={inputRef} type="file" accept=".csv,text/csv" onChange={handleFile}
        className="block w-full text-sm text-cream-mute file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:bg-cocoa-800 file:text-cream hover:file:bg-cocoa-700 cursor-pointer"
        aria-label="Select CSV"
      />
      {error && <p className="rounded-xl border border-hotpink/30 bg-hotpink/10 px-3 py-2 text-xs text-hotpink-soft" role="alert">{error}</p>}
      {preview.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-cream-mute">{preview.length} row{preview.length !== 1 ? "s" : ""} parsed:</p>
          <div className="rounded-2xl border border-cocoa-700 bg-cocoa-950 overflow-x-auto max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cocoa-900">
                <tr className="border-b border-cocoa-800">
                  {["Vendor", "Material", "Old $", "New $", "FRED"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-cream-mute font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-cocoa-800/50">
                    <td className="px-3 py-1.5 text-cream">{row.vendorName}</td>
                    <td className="px-3 py-1.5 text-cream-dim">{row.material}</td>
                    <td className="px-3 py-1.5 font-mono">{formatCurrency(row.baselineUnitCost)}</td>
                    <td className="px-3 py-1.5 font-mono text-hotpink-soft">{formatCurrency(row.quotedUnitCost)}</td>
                    <td className="px-3 py-1.5 text-cream-mute font-mono text-[10px]">{row.fredCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button size="sm" onClick={handleImport} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {loading ? "Saving…" : `Import ${preview.length} vendor${preview.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Add Vendor Form ──────────────────────────────────────────────────────────

function AddVendorForm({ onAdd, onClose }: { onAdd: (v: VendorEntry) => Promise<void>; onClose: () => void }) {
  const uid = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    vendor_name: "", material: "", unit: "unit",
    contact_name: "", contact_email: "",
    baseline: "", quoted: "", quantity: "1",
    fred_code: COMMODITY_CATALOG[2]?.code ?? "",
    date_quoted: new Date().toISOString().slice(0, 10),
  });

  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const selectedFred = COMMODITY_CATALOG.find((c) => c.code === form.fred_code);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const baseline = parseFloat(form.baseline);
    const quoted = parseFloat(form.quoted);
    const qty = parseFloat(form.quantity);
    if (!form.vendor_name.trim()) return setError("Vendor name is required.");
    if (!form.material.trim()) return setError("Material is required.");
    if (!form.fred_code) return setError("Select a FRED series.");
    if (isNaN(baseline) || baseline <= 0) return setError("Baseline cost must be > 0.");
    if (isNaN(quoted) || quoted <= 0) return setError("Quoted cost must be > 0.");
    if (quoted <= baseline) return setError("Quoted cost must exceed baseline to flag an anomaly.");
    if (isNaN(qty) || qty <= 0) return setError("Quantity must be > 0.");

    setLoading(true);
    try {
      let fredPpi = 0;
      try {
        const r = await fetch(`/api/surcharge/fred?codes=${form.fred_code}`);
        const d = await r.json() as { data?: Record<string, { deltaPct: number | null }> };
        fredPpi = d.data?.[form.fred_code]?.deltaPct ?? 0;
      } catch {}

      await onAdd({
        id: `manual-${Date.now()}`,
        vendorName: form.vendor_name.trim(),
        material: form.material.trim(),
        unit: form.unit.trim() || "unit",
        contactName: form.contact_name.trim(),
        contactEmail: form.contact_email.trim(),
        baselineUnitCost: baseline,
        quotedUnitCost: quoted,
        quantity: qty,
        fredCode: form.fred_code,
        fredLabel: selectedFred?.label ?? form.fred_code,
        fredPpiYoyPct: fredPpi,
        status: "flagged",
        dateQuoted: form.date_quoted,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add vendor");
    } finally { setLoading(false); }
  }

  const fc = "w-full rounded-xl border border-cocoa-700 bg-cocoa-950 px-3 py-2 text-sm text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant focus:border-vibrant";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-cocoa-950/80 backdrop-blur-sm overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="add-vendor-title">
      <div className="w-full max-w-2xl rounded-3xl border border-cocoa-700 bg-cocoa-900 shadow-2xl p-7 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 id="add-vendor-title" className="font-display text-xl">Flag vendor price increase</h2>
          <button onClick={onClose} className="text-cream-mute hover:text-cream p-1 rounded-lg hover:bg-cocoa-800" aria-label="Close"><X className="size-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${uid}-vn`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Vendor name *</label>
              <input id={`${uid}-vn`} className={fc} value={form.vendor_name} onChange={(e) => setF("vendor_name", e.target.value)} placeholder="Apex Steel Fabricators" required />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${uid}-mat`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Material *</label>
              <input id={`${uid}-mat`} className={fc} value={form.material} onChange={(e) => setF("material", e.target.value)} placeholder="Stainless Steel Rod" required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${uid}-unit`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Unit</label>
              <input id={`${uid}-unit`} className={fc} value={form.unit} onChange={(e) => setF("unit", e.target.value)} placeholder="unit, lb, gal…" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${uid}-base`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Old $/unit *</label>
              <input id={`${uid}-base`} type="number" min="0.001" step="any" className={fc} value={form.baseline} onChange={(e) => setF("baseline", e.target.value)} placeholder="480" required />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${uid}-quot`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">New $/unit *</label>
              <input id={`${uid}-quot`} type="number" min="0.001" step="any" className={fc} value={form.quoted} onChange={(e) => setF("quoted", e.target.value)} placeholder="522" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${uid}-qty`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Quantity</label>
              <input id={`${uid}-qty`} type="number" min="0.001" step="any" className={fc} value={form.quantity} onChange={(e) => setF("quantity", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${uid}-date`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Date quoted</label>
              <input id={`${uid}-date`} type="date" className={fc} value={form.date_quoted} onChange={(e) => setF("date_quoted", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-fred`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">FRED benchmark *</label>
            <select id={`${uid}-fred`} className={fc} value={form.fred_code} onChange={(e) => setF("fred_code", e.target.value)} required>
              <option value="">— Select commodity index —</option>
              {COMMODITY_CATALOG.map((c) => (<option key={c.code} value={c.code}>{c.label}</option>))}
            </select>
            {selectedFred && <p className="text-[10px] text-cream-mute mt-0.5">{selectedFred.blurb}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${uid}-cn`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Contact name</label>
              <input id={`${uid}-cn`} className={fc} value={form.contact_name} onChange={(e) => setF("contact_name", e.target.value)} placeholder="Marcus Webb" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${uid}-ce`} className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">Contact email</label>
              <input id={`${uid}-ce`} type="email" className={fc} value={form.contact_email} onChange={(e) => setF("contact_email", e.target.value)} placeholder="mwebb@vendor.com" />
            </div>
          </div>
          {error && <p className="rounded-xl border border-hotpink/30 bg-hotpink/10 px-3 py-2 text-xs text-hotpink-soft" role="alert">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button type="submit" size="sm" disabled={loading} className="flex-1">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {loading ? "Saving…" : "Flag vendor"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function NegotiationToolScreen({
  initialMaterials,
  businessName,
  userEmail,
  emailConnection,
}: {
  initialMaterials: InitialMaterial[];
  businessName: string;
  userEmail: string;
  emailConnection: EmailConnectionStatus;
}) {
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortBy, setSortBy] = useState<"overage" | "date">("overage");

  // Local email connection state — starts from server prop, updates on disconnect
  const [emailConn, setEmailConn] =
    useState<EmailConnectionStatus>(emailConnection);

  // Disconnect state
  const [disconnecting, setDisconnecting] = useState(false);

  // OAuth return URL handling — detect ?email_connected / ?email_error params
  const [oauthBanner, setOauthBanner] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("email_connected");
    const error = params.get("email_error");
    if (connected) {
      setOauthBanner({
        ok: true,
        message: `${connected === "google" ? "Gmail" : "Outlook"} connected successfully.`,
      });
    } else if (error) {
      setOauthBanner({ ok: false, message: decodeURIComponent(error) });
    }
    if (connected || error) {
      // Clean the URL without reloading
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  async function handleDisconnect(platform: "google" | "microsoft") {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/auth/${platform}/disconnect`, {
        method: "POST",
      });
      if (res.ok) {
        setEmailConn({ platform: null, email: null, name: null });
        setOauthBanner({
          ok: true,
          message: `${platform === "google" ? "Gmail" : "Outlook"} disconnected.`,
        });
      } else {
        const d = await res.json();
        setOauthBanner({
          ok: false,
          message: d.error ?? "Disconnect failed",
        });
      }
    } catch {
      setOauthBanner({ ok: false, message: "Network error during disconnect" });
    } finally {
      setDisconnecting(false);
    }
  }

  // Hydrate vendors from server-supplied materials as un-negotiated rows.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows: VendorEntry[] = initialMaterials.map((m) => ({
      id: m.id,
      vendorName: "",
      material: m.name,
      unit: m.unit,
      contactName: "",
      contactEmail: "",
      baselineUnitCost: m.baselineCost,
      quotedUnitCost: 0,
      quantity: m.quantity,
      fredCode: m.fredCode,
      fredLabel: m.fredLabel,
      fredPpiYoyPct: m.annualDriftPct,
      status: "flagged",
      dateQuoted: today,
    }));
    setVendors(rows);
  }, [initialMaterials]);

  const [showAddForm, setShowAddForm] = useState(false);

  // Load persisted anomalies from Supabase on top of material rows
  useEffect(() => {
    fetch("/api/negotiate")
      .then((r) => r.json())
      .then((data: { anomalies?: Array<{
        id: string; vendor_name: string; material: string; unit: string;
        contact_name: string | null; contact_email: string | null;
        baseline_unit_cost: number; quoted_unit_cost: number; quantity: number;
        fred_code: string; fred_label: string; fred_ppi_yoy_pct: number;
        status: NegotiationStatus; date_quoted: string;
      }> }) => {
        if (data.anomalies && data.anomalies.length > 0) {
          const persisted: VendorEntry[] = data.anomalies.map((a) => ({
            id: a.id,
            vendorName: a.vendor_name,
            material: a.material,
            unit: a.unit,
            contactName: a.contact_name ?? "",
            contactEmail: a.contact_email ?? "",
            baselineUnitCost: Number(a.baseline_unit_cost),
            quotedUnitCost: Number(a.quoted_unit_cost),
            quantity: Number(a.quantity),
            fredCode: a.fred_code,
            fredLabel: a.fred_label,
            fredPpiYoyPct: Number(a.fred_ppi_yoy_pct),
            status: a.status,
            dateQuoted: a.date_quoted,
          }));
          // Merge: persisted anomalies first, then material rows not already persisted
          setVendors((prev) => {
            const persistedIds = new Set(persisted.map((p) => p.id));
            const materialRows = prev.filter((v) => !persistedIds.has(v.id));
            return [...persisted, ...materialRows];
          });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddVendor(v: VendorEntry) {
    setVendors((prev) => [v, ...prev]);
    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_name: v.vendorName, material: v.material, unit: v.unit,
          contact_name: v.contactName, contact_email: v.contactEmail,
          baseline_unit_cost: v.baselineUnitCost, quoted_unit_cost: v.quotedUnitCost,
          quantity: v.quantity, fred_code: v.fredCode, fred_label: v.fredLabel,
          fred_ppi_yoy_pct: v.fredPpiYoyPct, date_quoted: v.dateQuoted,
        }),
      });
      const data = await res.json() as { anomalies?: Array<{ id: string }> };
      if (res.ok && data.anomalies?.[0]?.id) {
        const savedId = data.anomalies[0].id;
        setVendors((prev) => prev.map((vv) => vv.id === v.id ? { ...vv, id: savedId } : vv));
      }
    } catch {}
  }

  async function handleImportVendors(rows: VendorEntry[]) {
    setVendors((prev) => [...rows, ...prev]);
    try {
      const payload = rows.map((v) => ({
        vendor_name: v.vendorName, material: v.material, unit: v.unit,
        contact_name: v.contactName, contact_email: v.contactEmail,
        baseline_unit_cost: v.baselineUnitCost, quoted_unit_cost: v.quotedUnitCost,
        quantity: v.quantity, fred_code: v.fredCode, fred_label: v.fredLabel,
        fred_ppi_yoy_pct: v.fredPpiYoyPct, date_quoted: v.dateQuoted,
      }));
      await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }

  function updateStatus(id: string, status: NegotiationStatus) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, status } : v)));
    // Persist status change if this is a DB-backed entry (UUID format, not material ID)
    if (/^[0-9a-f]{8}-/.test(id)) {
      fetch("/api/negotiate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      }).catch(() => {});
    }
  }
  function updateQuotedCost(id: string, value: number) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, quotedUnitCost: value } : v)));
  }
  function updateVendorName(id: string, value: string) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, vendorName: value } : v)));
  }
  function updateContactName(id: string, value: string) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, contactName: value } : v)));
  }
  function updateContactEmail(id: string, value: string) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, contactEmail: value } : v)));
  }

  const filtered = useMemo(() => {
    let list = filterStatus === "all" ? vendors : vendors.filter((v) => v.status === filterStatus);
    if (sortBy === "overage") {
      list = [...list].sort((a, b) => {
        const oa = computeEntry(a).overagePct;
        const ob = computeEntry(b).overagePct;
        return ob - oa;
      });
    } else {
      list = [...list].sort((a, b) => b.dateQuoted.localeCompare(a.dateQuoted));
    }
    return list;
  }, [vendors, filterStatus, sortBy]);

  // KPIs (only quoted vendors contribute to overage stats)
  const quoted = vendors.filter((v) => v.quotedUnitCost > 0);
  const totalOverage = quoted.reduce((s, v) => {
    const c = computeEntry(v);
    return s + (c.overageTotal > 0 ? c.overageTotal : 0);
  }, 0);
  const flaggedCount = vendors.filter((v) => v.status === "flagged").length;
  const avgExcess = (() => {
    const overageVendors = quoted.filter((v) => computeEntry(v).overagePct > 0);
    if (!overageVendors.length) return 0;
    return overageVendors.reduce((s, v) => s + computeEntry(v).overagePct, 0) / overageVendors.length;
  })();

  return (
    <div className="space-y-10">
      <ScreenHeader
        eyebrow={COPY.negotiate.eyebrow}
        headline={COPY.negotiate.headline}
        sub={COPY.negotiate.sub}
        trailing={
          <div className="flex items-center gap-2">
            <CSVImportPanel onImport={handleImportVendors} />
            <Button variant="electric" size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="size-3.5" />
              Flag vendor
            </Button>
          </div>
        }
      />

      {/* OAuth banner */}
      {oauthBanner && (
        <div
          className={cn(
            "rounded-2xl border px-4 py-3 flex items-start gap-2 text-sm",
            oauthBanner.ok
              ? "border-electric/40 bg-electric/10 text-electric-soft"
              : "border-hotpink/40 bg-hotpink/10 text-hotpink-soft"
          )}
        >
          {oauthBanner.ok ? (
            <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          )}
          <span>{oauthBanner.message}</span>
          <button
            onClick={() => setOauthBanner(null)}
            className="ml-auto text-cream-mute hover:text-cream shrink-0"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Email provider connection */}
      <div className="rounded-2xl border border-cocoa-700 bg-cocoa-900/70 px-5 py-4">
        {emailConn.platform ? (
          // ── Connected state ──────────────────────────────────────────────
          <div className="flex items-center gap-3 flex-wrap">
            <div
              className={cn(
                "size-8 rounded-xl flex items-center justify-center shrink-0",
                emailConn.platform === "google"
                  ? "bg-white/10"
                  : "bg-blue-900/30"
              )}
            >
              <Mail className="size-4 text-vibrant" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-cream-mute">
                {emailConn.platform === "google" ? "Gmail" : "Outlook"} connected
              </p>
              <p className="text-sm text-cream truncate">
                {emailConn.email}
                {emailConn.name && (
                  <span className="text-cream-mute ml-2">· {emailConn.name}</span>
                )}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDisconnect(emailConn.platform!)}
              disabled={disconnecting}
              className="text-cream-mute shrink-0"
            >
              {disconnecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Link2Off className="size-3.5" />
              )}
              Disconnect
            </Button>
          </div>
        ) : (
          // ── Not connected state ──────────────────────────────────────────
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-cream">Connect your email</p>
              <p className="text-xs text-cream-mute mt-0.5">
                Negotiation emails send directly from your inbox. Vendors see
                your real address and replies land in your inbox.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.location.href = "/api/auth/google/connect";
                }}
              >
                <Mail className="size-3.5" />
                Connect Gmail
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.location.href = "/api/auth/microsoft/connect";
                }}
              >
                <Mail className="size-3.5" />
                Connect Outlook
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-3xl border border-hotpink/30 bg-cocoa-900/70 p-6 shadow-card relative overflow-hidden">
          <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">Total unexplained overage</p>
          <p className="font-display text-4xl mt-3 text-hotpink-soft">
            {formatCurrency(totalOverage)}
          </p>
          <p className="text-xs text-cream-mute mt-2">above FRED PPI-justified costs</p>
        </div>
        <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card">
          <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">Vendors flagged</p>
          <p className="font-display text-4xl mt-3">{flaggedCount}</p>
          <p className="text-xs text-cream-mute mt-2">of {vendors.length} tracked materials</p>
        </div>
        <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/70 p-6 shadow-card">
          <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">Avg excess above FRED</p>
          <p className="font-display text-4xl mt-3 text-hotpink-soft">{formatPercent(avgExcess)}</p>
          <p className="text-xs text-cream-mute mt-2">across over-priced vendors</p>
        </div>
      </div>

      {/* Filter / sort bar */}
      {vendors.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-cocoa-900 border border-cocoa-700 rounded-2xl p-1">
            {(["all", "flagged", "in-progress", "resolved"] as FilterStatus[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-medium transition-colors capitalize",
                  filterStatus === f
                    ? "bg-cocoa-700 text-cream"
                    : "text-cream-mute hover:text-cream"
                )}
              >
                {f === "all"
                  ? `All (${vendors.length})`
                  : f === "in-progress"
                  ? `In Progress (${vendors.filter((v) => v.status === f).length})`
                  : `${STATUS_CONFIG[f].label} (${vendors.filter((v) => v.status === f).length})`}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Filter className="size-3.5 text-cream-mute" />
            <span className="text-xs text-cream-mute">Sort:</span>
            <button
              onClick={() => setSortBy("overage")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-xl border transition-colors",
                sortBy === "overage"
                  ? "border-cocoa-600 bg-cocoa-800 text-cream"
                  : "border-cocoa-700 text-cream-mute hover:text-cream"
              )}
            >
              Highest overage
            </button>
            <button
              onClick={() => setSortBy("date")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-xl border transition-colors",
                sortBy === "date"
                  ? "border-cocoa-600 bg-cocoa-800 text-cream"
                  : "border-cocoa-700 text-cream-mute hover:text-cream"
              )}
            >
              Most recent
            </button>
          </div>
        </div>
      )}

      {/* Vendor inbox */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-cocoa-700 p-12 text-center">
            <CheckCircle2 className="size-8 text-electric-soft mx-auto mb-3" />
            <p className="text-cream-dim font-medium">
              {vendors.length === 0
                ? "No tracked materials yet."
                : "No vendors matching this filter."}
            </p>
            <p className="text-sm text-cream-mute mt-1">
              {vendors.length === 0
                ? "Add cost inputs on the Inputs screen to start tracking vendor quotes."
                : "All vendor pricing is within FRED benchmarks."}
            </p>
          </div>
        ) : (
          filtered.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              businessName={businessName}
              emailConnection={emailConn}
              onStatusChange={updateStatus}
              onVendorNameChange={updateVendorName}
              onQuotedCostChange={updateQuotedCost}
              onContactNameChange={updateContactName}
              onContactEmailChange={updateContactEmail}
            />
          ))
        )}
      </div>

      <div className="rounded-2xl border border-cocoa-700 bg-cocoa-900 px-5 py-4 flex items-start gap-3">
        <Info className="size-4 text-cream-mute mt-0.5 shrink-0" />
        <p className="text-xs text-cream-mute leading-relaxed">
          Vendor rows are populated from your tracked materials. Enter the quoted unit cost
          received from the supplier — overage vs. live FRED PPI is computed instantly via{" "}
          <code className="text-vibrant-soft">FRED_API_KEY</code>. One-click email sends via{" "}
          <code className="text-vibrant-soft">RESEND_API_KEY</code> using your verified{" "}
          <code className="text-vibrant-soft">attagency.co</code> domain.
          Use &quot;Import CSV&quot; or &quot;Flag vendor&quot; to add standalone price hikes
          that persist across sessions via Supabase.
        </p>
      </div>

      {showAddForm && (
        <AddVendorForm
          onAdd={handleAddVendor}
          onClose={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
}
