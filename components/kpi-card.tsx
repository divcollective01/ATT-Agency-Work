import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  hint,
  tone = "neutral"
}: {
  label: string;
  value: string;
  delta?: { value: string; up: boolean };
  hint?: string;
  tone?: "neutral" | "warn" | "good" | "electric";
}) {
  const toneRing = {
    neutral: "border-cocoa-700",
    warn: "border-vibrant/50",
    good: "border-electric/50",
    electric: "border-jackson/60"
  }[tone];

  return (
    <div className={cn("rounded-3xl border bg-cocoa-900/70 p-6 shadow-card relative overflow-hidden", toneRing)}>
      {tone === "warn" && (
        <div className="absolute -top-12 -right-12 size-36 rounded-full bg-vibrant/15 blur-2xl" />
      )}
      <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute">{label}</p>
      <p className="font-display text-4xl md:text-5xl mt-3 tracking-tight">{value}</p>
      <div className="mt-3 flex items-center gap-2 text-xs">
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1",
              delta.up
                ? "bg-hotpink/20 text-hotpink-soft"
                : "bg-electric/20 text-electric-soft"
            )}
          >
            {delta.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {delta.value}
          </span>
        )}
        {hint && <span className="text-cream-mute">{hint}</span>}
      </div>
    </div>
  );
}
