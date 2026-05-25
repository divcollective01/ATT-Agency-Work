"use client";

import { Check, Loader2 } from "lucide-react";
import { useTellerConnection } from "./connection-context";
import { formatCurrency } from "@/lib/utils";

export function ConnectedBanner() {
  const { connected, loading, institutionName, tellerData } = useTellerConnection();
  if (!connected) return null;

  const acctCount = tellerData?.accounts.length ?? 0;
  const txCount = tellerData?.transactions.length ?? 0;
  const totalBalance = tellerData?.accounts.reduce(
    (s, a) => s + (a.balanceCurrent ?? 0),
    0
  );

  return (
    <div className="rounded-2xl border border-electric/40 bg-electric/10 px-5 py-4 flex items-center gap-3">
      <div className="size-9 rounded-xl bg-electric text-cream flex items-center justify-center shrink-0">
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">
          {loading
            ? "Syncing bank data…"
            : `Connected${institutionName ? ` — ${institutionName}` : ""}`}
        </p>
        <p className="text-xs text-cream-mute mt-0.5">
          {loading
            ? "Authenticating with Teller and fetching transactions."
            : tellerData
            ? `${acctCount} account${acctCount !== 1 ? "s" : ""} · ${txCount} transaction${txCount !== 1 ? "s" : ""} imported${totalBalance != null ? ` · Balance ${formatCurrency(totalBalance)}` : ""}`
            : "Authenticated with Teller. Transactions will populate shortly."}
        </p>
      </div>
    </div>
  );
}
