import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, opts: { compact?: boolean } = {}) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 2
  }).format(value);
}

export function formatPercent(value: number, fractionDigits = 1) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

export function pctDelta(now: number, then: number) {
  if (!then) return 0;
  return ((now - then) / then) * 100;
}
