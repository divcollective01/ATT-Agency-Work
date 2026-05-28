"use client";

/**
 * Screen 06 — Vendor Price Negotiation Tool
 *
 * Pulls tracked material inputs from Supabase, blends them with live FRED PPI
 * benchmarks, and lets the user enter the actual quoted vendor price increase
 * directly into the row. Overage vs. FRED is computed live.
 *
 * Required env vars (for live FRED data):
 *   FRED_API_KEY  — St. Louis Fed API key
 *
 * Email-send integrations (implement when keys are available):
 *   SENDGRID_API_KEY     — or RESEND_API_KEY for transactional email
 */

import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/screen-header";
import { COPY } from "@/lib/copy";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type NegotiationStatus = "flagged" | "in-progress" | "resolved";
type FilterStatus = "all" | NegotiationStatus;

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

function generateEmailBody(v: VendorEntry): string {
  const c = computeEntry(v);
  const companyName = "ATT Agency";
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
[Your Name]
${companyName}

---
Data source: St. Louis Federal Reserve FRED — ${v.fredLabel} (${v.fredCode})
Retrieved: ${today}`;
}

function generateEmailDraft(v: VendorEntry): string {
  return `Subject: ${generateEmailSubject(v)}\n\n${generateEmailBody(v)}`;
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
  senderFrom,
  onStatusChange,
  onVendorNameChange,
  onQuotedCostChange,
  onContactNameChange,
  onContactEmailChange,
}: {
  vendor: VendorEntry;
  senderFrom: string;
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
  const canSend = hasQuote && vendor.contactEmail.trim().length > 0;

  function copyEmail() {
    navigator.clipboard.writeText(generateEmailDraft(vendor)).then(() => {
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
          body: generateEmailBody(vendor),
          from: senderFrom.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.sent) {
        setSendStatus({ ok: true, message: `Sent to ${vendor.contactEmail} · id ${data.id ?? "(no id)"}` });
        onStatusChange(vendor.id, "in-progress");
      } else {
        setSendStatus({ ok: false, message: data.error ?? "Send failed" });
      }
    } catch (err: any) {
      setSendStatus({ ok: false, message: err?.message ?? "Network error sending email" });
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
                    title={!canSend ? "Add a contact email above to enable sending" : undefined}
                  >
                    {sending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    {sending ? "Sending…" : "Send via Resend"}
                  </Button>
                </div>
              </div>
              <pre className="rounded-2xl border border-cocoa-700 bg-cocoa-950 px-5 py-4 text-xs text-cream-dim font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto">
                {generateEmailDraft(vendor)}
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
                Replace [Your Name] before sending. From-address is set at the top of this screen.
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export function NegotiationToolScreen({
  initialMaterials,
}: {
  initialMaterials: InitialMaterial[];
}) {
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortBy, setSortBy] = useState<"overage" | "date">("overage");
  // Resend "from" address. Default uses Resend's shared sandbox sender so the
  // app works out of the box. Replace with `Your Name <you@yourdomain.com>`
  // once you verify a domain in Resend → Domains.
  const [senderFrom, setSenderFrom] = useState<string>("Profit Shield <onboarding@resend.dev>");

  // Persist sender across sessions so the user doesn't re-enter it each visit.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ps:negotiate:sender");
      if (saved) setSenderFrom(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("ps:negotiate:sender", senderFrom);
    } catch {}
  }, [senderFrom]);

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

  function updateStatus(id: string, status: NegotiationStatus) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, status } : v)));
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
      />

      {/* Sender configuration */}
      <div className="rounded-2xl border border-cocoa-700 bg-cocoa-900/70 px-5 py-4 flex items-center gap-4 flex-wrap">
        <Mail className="size-4 text-vibrant shrink-0" />
        <div className="flex-1 min-w-[240px]">
          <label className="text-[10px] uppercase tracking-[0.18em] text-cream-mute block mb-1">
            Send from (Resend)
          </label>
          <input
            type="text"
            value={senderFrom}
            onChange={(e) => setSenderFrom(e.target.value)}
            placeholder="Your Name <you@yourdomain.com>"
            className="h-9 w-full rounded-xl border border-cocoa-700 bg-cocoa-950 px-3 text-sm text-cream placeholder:text-cream-mute focus:outline-none focus:ring-1 focus:ring-vibrant focus:border-vibrant font-mono"
          />
        </div>
        <p className="text-[11px] text-cream-mute max-w-sm leading-snug">
          Defaults to Resend&apos;s sandbox sender (works immediately, &ldquo;via resend.dev&rdquo; footer).
          Switch to your verified domain once added at resend.com/domains.
        </p>
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
              senderFrom={senderFrom}
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
          <code className="text-vibrant-soft">FRED_API_KEY</code>. Email drafts can be sent
          automatically by configuring <code className="text-vibrant-soft">SENDGRID_API_KEY</code>{" "}
          or <code className="text-vibrant-soft">RESEND_API_KEY</code>.
        </p>
      </div>
    </div>
  );
}
