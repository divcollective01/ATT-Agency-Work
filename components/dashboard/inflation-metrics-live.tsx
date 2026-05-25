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
import type { NormalizedTransaction } from "@/lib/inflation-engine";

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
          <CardTitle>YoY Inflation vs Operational Drift</CardTitle>
          <CardDescription>
            Link a bank to compare this month&apos;s category-level spend against the
            same month last year, adjusted for the macro inflation rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<Database className="size-5" />}
            title="No transactions in stream"
            body="Connect Teller to feed the YoY inflation engine with live bucketed transactions."
            action={<ConnectTellerButton variant="electric" size="sm" />}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <InflationMetrics
      transactions={transactions}
      targetYear={targetYear}
      targetMonth={targetMonth}
    />
  );
}

export function InflationMetricsLive() {
  return (
    <TellerConnectionProvider>
      <InflationMetricsLiveInner />
    </TellerConnectionProvider>
  );
}
