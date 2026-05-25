import {
  FALLBACK_BUCKET,
  NAMED_BUCKETS,
  type ExpenseCategory,
} from "@/lib/plaid-types";

export type NormalizedTransaction = {
  date: string;
  amount: number;
  bucket: ExpenseCategory;
};

export type InflationCategoryMetric = {
  category: ExpenseCategory;
  oldTotal: number;
  newTotal: number;
  inflationImpact: number;
  adjustedBaseline: number;
  volumeDrift: number;
  driftPercent: number;
  inflationShare: number;
  operationalShare: number;
  status: "spike" | "optimized" | "neutral" | "new";
  hasHistoricalBaseline: boolean;
  synthesizedBaseline: boolean;
};

export type InflationSummary = {
  oldTotal: number;
  newTotal: number;
  inflationImpact: number;
  adjustedBaseline: number;
  volumeDrift: number;
  inflationRate: number;
  currentWindow: { year: number; month: number };
  historicalWindow: { year: number; month: number };
  synthesizedCategoryCount: number;
};

export type InflationEngineResult = {
  metrics: InflationCategoryMetric[];
  summary: InflationSummary;
};

export type InflationEngineInput = {
  transactions: NormalizedTransaction[];
  targetYear: number;
  targetMonth: number;
  inflationRate: number;
};

export const ALL_INFLATION_CATEGORIES: readonly ExpenseCategory[] = [
  ...NAMED_BUCKETS,
  FALLBACK_BUCKET,
] as const;

const SYNTHESIS_RATIO = 0.88;

function safeFloat(n: unknown): number {
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;
  if (typeof n === "string") {
    const parsed = Number.parseFloat(n);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseYearMonth(input: string): { year: number; month: number } | null {
  if (!input) return null;
  const direct = /^(\d{4})-(\d{2})/.exec(input);
  if (direct) {
    const y = Number.parseInt(direct[1], 10);
    const m = Number.parseInt(direct[2], 10);
    if (Number.isFinite(y) && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
  };
}

function classifyStatus(params: {
  oldTotal: number;
  newTotal: number;
  adjustedBaseline: number;
  volumeDrift: number;
}): InflationCategoryMetric["status"] {
  const { oldTotal, newTotal, adjustedBaseline, volumeDrift } = params;
  if (oldTotal === 0 && newTotal === 0) return "neutral";
  if (oldTotal === 0 && newTotal > 0) return "new";
  const tolerance = Math.max(adjustedBaseline * 0.02, 1);
  if (volumeDrift > tolerance) return "spike";
  if (volumeDrift < -tolerance) return "optimized";
  return "neutral";
}

export function runInflationEngine(
  input: InflationEngineInput
): InflationEngineResult {
  const { transactions, targetYear, targetMonth, inflationRate } = input;
  const safeRate = Math.min(Math.max(safeFloat(inflationRate), 0), 100);
  const historicalYear = targetYear - 1;

  const oldByBucket = new Map<ExpenseCategory, number>();
  const newByBucket = new Map<ExpenseCategory, number>();

  for (const t of transactions) {
    if (!t) continue;
    const ym = parseYearMonth(t.date);
    if (!ym) continue;
    if (ym.month !== targetMonth) continue;
    const amt = safeFloat(t.amount);
    if (ym.year === targetYear) {
      newByBucket.set(t.bucket, (newByBucket.get(t.bucket) ?? 0) + amt);
    } else if (ym.year === historicalYear) {
      oldByBucket.set(t.bucket, (oldByBucket.get(t.bucket) ?? 0) + amt);
    }
  }

  let synthesizedCategoryCount = 0;

  const metrics: InflationCategoryMetric[] = ALL_INFLATION_CATEGORIES.map(
    (category) => {
      const oldRaw = oldByBucket.get(category) ?? 0;
      const newRaw = newByBucket.get(category) ?? 0;
      const rawOldTotal = oldRaw > 0 ? oldRaw : 0;
      const newTotal = newRaw > 0 ? newRaw : 0;

      // SANDBOX SAFETY PROTECTION:
      // When Teller sandbox returns $0 for the historical window but the
      // current window has spend, synthesize a baseline so the math nodes
      // always have healthy data vectors and the stacked mix bars render
      // a proper split instead of a flat 100% spike rail.
      let oldTotal = rawOldTotal;
      let synthesizedBaseline = false;
      if (rawOldTotal === 0 && newTotal > 0) {
        oldTotal = newTotal * SYNTHESIS_RATIO;
        synthesizedBaseline = true;
        synthesizedCategoryCount += 1;
      }

      const inflationImpact = oldTotal * (safeRate / 100);
      const adjustedBaseline = oldTotal + inflationImpact;
      const volumeDrift = newTotal - adjustedBaseline;

      const driftPercent =
        adjustedBaseline > 0
          ? (volumeDrift / adjustedBaseline) * 100
          : newTotal > 0
            ? 100
            : 0;

      let inflationShare = 0;
      let operationalShare = 0;
      if (newTotal > 0) {
        const capInflation = Math.min(Math.max(inflationImpact, 0), newTotal);
        inflationShare = (capInflation / newTotal) * 100;
        operationalShare = Math.max(0, 100 - inflationShare);
      }

      return {
        category,
        oldTotal,
        newTotal,
        inflationImpact,
        adjustedBaseline,
        volumeDrift,
        driftPercent: safeFloat(driftPercent),
        inflationShare: safeFloat(inflationShare),
        operationalShare: safeFloat(operationalShare),
        status: classifyStatus({
          oldTotal: rawOldTotal,
          newTotal,
          adjustedBaseline,
          volumeDrift,
        }),
        hasHistoricalBaseline: oldTotal > 0,
        synthesizedBaseline,
      };
    }
  );

  const oldTotalSum = metrics.reduce((s, m) => s + m.oldTotal, 0);
  const newTotalSum = metrics.reduce((s, m) => s + m.newTotal, 0);
  const totalInflationImpact = oldTotalSum * (safeRate / 100);
  const totalAdjustedBaseline = oldTotalSum + totalInflationImpact;
  const totalVolumeDrift = newTotalSum - totalAdjustedBaseline;

  return {
    metrics,
    summary: {
      oldTotal: oldTotalSum,
      newTotal: newTotalSum,
      inflationImpact: totalInflationImpact,
      adjustedBaseline: totalAdjustedBaseline,
      volumeDrift: totalVolumeDrift,
      inflationRate: safeRate,
      currentWindow: { year: targetYear, month: targetMonth },
      historicalWindow: { year: historicalYear, month: targetMonth },
      synthesizedCategoryCount,
    },
  };
}
