"use client";

import { useMemo } from "react";
import { Receipt, Wallet } from "lucide-react";
import { ScreenHeader } from "@/components/screen-header";
import { KpiCard } from "@/components/kpi-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { TellerConnectionProvider, useTellerConnection } from "@/components/plaid/connection-context";
import { ConnectTellerButton } from "@/components/plaid/connect-plaid-button";
import { ConnectedBanner } from "@/components/plaid/connected-banner";
import { COPY } from "@/lib/copy";
import { formatCurrency } from "@/lib/utils";
import {
  classifyBucket,
  isNamedBucket,
  type TellerTransaction,
  type SpendingBucket,
} from "@/lib/plaid-types";

// ── Helpers ───────────────────────────────────────────────────────────

function isCurrentMonth(dateStr: string) {
  const now = new Date();
  const d = new Date(dateStr);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function computeSpend(txns: TellerTransaction[]) {
  return txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
}

function bucketTotals(txns: TellerTransaction[]): Array<{ name: string; total: number }> {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.amount <= 0) continue;
    const bucket = classifyBucket(t);
    map.set(bucket, (map.get(bucket) ?? 0) + t.amount);
  }
  return Array.from(map.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function estimateRecurring(txns: TellerTransaction[]) {
  const keywords = ["subscription", "monthly", "recurring", "membership", "saas", "cloud"];
  const recurring = txns.filter((t) => {
    if (t.amount <= 0) return false;
    const blob = `${t.merchantName ?? ""} ${t.name}`.toLowerCase();
    const bucket = classifyBucket(t);
    return bucket === "Software" || keywords.some((k) => blob.includes(k));
  });
  return recurring.reduce((s, t) => s + t.amount, 0);
}

// ── Bucket bar chart (Tailwind only) ──────────────────────────────────

const NAMED_BUCKET_COLORS: Record<string, string> = {
  Software: "bg-electric",
  Rent: "bg-jackson",
  Logistics: "bg-vibrant",
  Payroll: "bg-hotpink",
  Materials: "bg-cream-dim",
  Marketing: "bg-electric-soft",
};

const FALLBACK_PALETTE = [
  "bg-cocoa-500",
  "bg-cocoa-400",
  "bg-jackson-soft",
  "bg-vibrant-soft",
  "bg-hotpink-soft",
];

function colorFor(bucket: SpendingBucket, index: number): string {
  if (isNamedBucket(bucket) && NAMED_BUCKET_COLORS[bucket]) {
    return NAMED_BUCKET_COLORS[bucket];
  }
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

function BucketBars({ txns }: { txns: TellerTransaction[] }) {
  const buckets = useMemo(() => bucketTotals(txns), [txns]);
  const max = buckets[0]?.total || 1;

  return (
    <div className="space-y-3">
      {buckets
        .filter((b) => b.total > 0)
        .map((b, i) => (
          <div key={b.name}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-cream">{b.name}</span>
              <span className="text-cream-mute">{formatCurrency(b.total)}</span>
            </div>
            <div className="h-3 rounded-full bg-cocoa-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${colorFor(b.name, i)}`}
                style={{ width: `${(b.total / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      {buckets.every((b) => b.total === 0) && (
        <p className="text-sm text-cream-mute text-center py-4">
          No debit transactions to categorize.
        </p>
      )}
    </div>
  );
}

// ── Transaction feed ──────────────────────────────────────────────────

function TransactionFeed({ txns }: { txns: TellerTransaction[] }) {
  const sorted = useMemo(
    () => [...txns].sort((a, b) => b.date.localeCompare(a.date)),
    [txns]
  );

  return (
    <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
      {sorted.map((t) => {
        const bucket = classifyBucket(t);
        return (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-cocoa-800/60 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {t.merchantName ?? t.name}
              </p>
              <p className="text-[11px] text-cream-mute mt-0.5">
                {t.date} · {bucket}
              </p>
            </div>
            <span
              className={`text-sm font-semibold whitespace-nowrap ${
                t.amount > 0 ? "text-hotpink-soft" : "text-electric-soft"
              }`}
            >
              {t.amount > 0 ? "−" : "+"}
              {formatCurrency(Math.abs(t.amount))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Inner screen ──────────────────────────────────────────────────────

function LeakDetectorInner() {
  const { connected, tellerData } = useTellerConnection();

  const txns = tellerData?.transactions ?? [];
  const thisMonthTxns = txns.filter((t) => isCurrentMonth(t.date));
  const activeTxns = thisMonthTxns.length > 0 ? thisMonthTxns : txns;

  const totalSpend = connected && tellerData ? computeSpend(activeTxns) : null;
  const buckets = useMemo(
    () => (tellerData ? bucketTotals(activeTxns) : []),
    [tellerData, activeTxns]
  );
  const largestBucket = buckets.find((b) => b.total > 0);
  const recurringTotal = connected && tellerData ? estimateRecurring(activeTxns) : null;

  return (
    <div className="space-y-10">
      <ScreenHeader
        eyebrow={COPY.leaks.eyebrow}
        headline={COPY.leaks.headline}
        sub={COPY.leaks.sub}
        trailing={<ConnectTellerButton size="lg" />}
      />

      <ConnectedBanner />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <KpiCard
          label="Total spend, this month"
          value={totalSpend !== null ? formatCurrency(totalSpend) : "—"}
          hint={
            totalSpend !== null
              ? `${activeTxns.filter((t) => t.amount > 0).length} debit transactions`
              : "Available after Teller sync."
          }
          tone={totalSpend !== null ? "warn" : "neutral"}
        />
        <KpiCard
          label="Largest bucket"
          value={largestBucket ? largestBucket.name : "—"}
          hint={
            largestBucket
              ? `${formatCurrency(largestBucket.total)} this period`
              : "Available after Teller sync."
          }
          tone={largestBucket ? "electric" : "neutral"}
        />
        <KpiCard
          label="Recurring subscriptions"
          value={recurringTotal !== null ? formatCurrency(recurringTotal) : "—"}
          hint={
            recurringTotal !== null
              ? "Software & subscription-pattern charges"
              : "Available after Teller sync."
          }
          tone={recurringTotal !== null && recurringTotal > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spending by bucket</CardTitle>
            <CardDescription>
              Every dollar lands in a bucket — named when we recognize the merchant,
              dynamic when we don&apos;t.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connected && tellerData && txns.length > 0 ? (
              <BucketBars txns={activeTxns} />
            ) : (
              <EmptyState
                icon={<Wallet className="size-6" />}
                title={COPY.leaks.emptyTitle}
                body={COPY.leaks.emptyBody}
                action={<ConnectTellerButton size="md" />}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <CardDescription>
              {connected && tellerData
                ? `${txns.length} imported from Teller.`
                : "Live feed once your bank is linked."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connected && tellerData && txns.length > 0 ? (
              <TransactionFeed txns={txns} />
            ) : (
              <EmptyState
                icon={<Receipt className="size-5" />}
                title="No transactions imported"
                body="Connect your bank via Teller to populate the activity feed."
                action={<ConnectTellerButton variant="electric" size="sm" />}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function LeakDetectorScreen() {
  return (
    <TellerConnectionProvider>
      <LeakDetectorInner />
    </TellerConnectionProvider>
  );
}
