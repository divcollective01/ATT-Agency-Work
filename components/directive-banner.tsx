import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function DirectiveBanner({
  message,
  cta,
  className
}: {
  message: string;
  cta?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-vibrant/40",
        "bg-gradient-to-br from-vibrant/15 via-cocoa-900 to-jackson/25",
        "p-8 md:p-12 grain",
        className
      )}
    >
      <div className="absolute -top-24 -right-24 size-72 rounded-full bg-vibrant/25 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-20 size-80 rounded-full bg-jackson/35 blur-3xl pointer-events-none" />

      <div className="relative flex items-start gap-4">
        <div className="hidden md:flex size-12 rounded-2xl bg-vibrant text-cocoa-950 items-center justify-center animate-pulse-glow">
          <AlertTriangle className="size-6" />
        </div>
        <div className="flex-1">
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-vibrant">
            <span className="inline-block size-2 rounded-full bg-vibrant animate-pulse" />
            Margin Alert
          </p>
          <h2 className="font-display text-display-lg mt-3 text-balance leading-[1.02]">
            {message}
          </h2>
          {cta && (
            <button className="mt-7 inline-flex items-center gap-2 rounded-full bg-cream text-cocoa-950 px-6 h-12 text-sm font-semibold hover:bg-vibrant transition-colors">
              {cta}
              <ArrowUpRight className="size-4" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
