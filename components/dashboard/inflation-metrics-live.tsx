"use client";

import * as React from "react";
import { Database } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import {
  TellerConnectionProvider,
  useTellerConnection,
} from "@/components/plaid/connection-context";
import { ConnectTellerButton } from "@/components/plaid/connect-plaid-button";
import {
  classifyBucket,
  parseTransactionAmount,
  type TellerTransaction,
} from "@/lib/plaid-types";
import { InflationMetrics } from "@/components/dashboard/inflation-metrics";
import { cn, formatCurrency } from "@/lib/utils";
import type { NormalizedTransaction } from "@/lib/inflation-engine";

const STORAGE_KEY = "att_dashboard_inflation_rate";
const DEFAULT_RATE = 3.5;

function readRate(): number {
  if (typeof window === "undefined") return DEFAULT_RATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RATE;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 15) : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function SpendingYoYCard({
  transactions,
  targetYear,
  targetMonth,
}: {
  transactions: NormalizedTransaction[];
  targetYear: number;
  targetMonth: number;
}) {
  const [rate, setRate] = React.useState(DEFAULT_RATE);
  React.useEffect(() => { setRate(readRate()); }, []);

  // Compare same window: Jan → targetMonth, prev year vs current year
  const prevSpend = React.useMemo(() =>
    transactions
      .filter((t) => {
        const [y, m] = t.date.split("-").map(Number);
        return y === targetYear - 1 && m <= targetMonth;
      })
      .reduce((s, t) => s + t.amount, 0),
    [transactions, targetYear, targetMonth]
  );

  const thisSpend = React.useMemo(() =>
    transactions
      .filter((t) => {
        const [y, m] = t.date.split("-").map(Number);
        return y === targetYear && m <= targetMonth;
      })
      .reduce((s, t) => s + t.amount, 0),
    [transactions, targetYear, targetMonth]
  );

  const inflAdjBaseline = prevSpend * (1 + rate / 100);
  const realDrift = thisSpend - inflAdjBaseline;
  const windowLabel = `Jan – ${MONTH_LABELS[targetMonth - 1]}`;

  const tiles: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    {
      label: `${targetYear - 1} Spend`,
      value: formatCurrency(prevSpend),
      sub: windowLabel,
    },
    {
      label: `${targetYear - 1} + Inflation (${rate.toFixed(1)}%)`,
      value: formatCurrency(inflAdjBaseline),
      sub: "Inflation-adjusted baseline",
      tone: "text-vibrant",
    },
    {
      label: `${targetYear} Spend`,
      value: formatCurrency(thisSpend),
      sub: `${windowLabel} YTD`,
    },
    {
      label: "Real volume change",
      value: `${realDrift >= 0 ? "+" : ""}${formatCurrency(realDrift)}`,
      sub: "Excluding inflation",
      tone: realDrift > 0 ? "text-hotpink-soft" : "text-electric-soft",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Spending — Year over Year</CardTitle>
        <CardDescription>
          Same {windowLabel} window compared across years. Real volume change strips out
          macro inflation so you can see whether you&apos;re actually spending more or less.
          Inflation rate is shared with the dial below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="rounded-2xl border border-cocoa-700 bg-cocoa-800/60 px-4 py-4"
            >
              <div className="text-[10px] uppercase tracking-[0.14em] text-cream-mute">
                {t.label}
              </div>
              <div className={cn("font-display text-2xl mt-2 tabular-nums", t.tone ?? "text-cream")}>
                {t.value}
              </div>
              {t.sub && (
                <div className="text-[10px] text-cream-mute mt-1">{t.sub}</div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function toNormalized(txns: TellerTransaction[]): NormalizedTransaction[] {
  const out: NormalizedTransaction[] = [];
  for (const t of txns) {
    if (!t?.date) continue;
    const amount = parseTransactionAmount(t.amount);
    if (amount <= 0) continue;
    out.push({
      date: t.date,
      amount,
      bucket: classifyBucket(t),
    });
  }
  return out;
}

function InflationMetricsLiveInner() {
  const { connected, tellerData } = useTellerConnection();

  const transactions = React.useMemo<NormalizedTransaction[]>(() => {
    if (!tellerData?.transactions?.length) return [];
    return toNormalized(tellerData.transactions);
  }, [tellerData]);

  const { targetYear, targetMonth } = React.useMemo(() => {
    const now = new Date();
    return {
      targetYear: now.getFullYear(),
      targetMonth: now.getMonth() + 1,
    };
  }, []);

  if (!connected || transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Business Spending — Year over Year</CardTitle>
          <CardDescription>
            Link a bank to compare this year&apos;s spend against last year, adjusted for inflation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<Database className="size-5" />}
            title="No transactions in stream"
            body="Connect Teller to feed the spending comparison and YoY inflation engine."
            action={<ConnectTellerButton variant="electric" size="sm" />}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <SpendingYoYCard
        transactions={transactions}
        targetYear={targetYear}
        targetMonth={targetMonth}
      />
      <InflationMetrics
        transactions={transactions}
        targetYear={targetYear}
        targetMonth={targetMonth}
      />
    </div>
  );
}

export function InflationMetricsLive() {
  return (
    <TellerConnectionProvider>
      <InflationMetricsLiveInner />
    </TellerConnectionProvider>
  );
}
