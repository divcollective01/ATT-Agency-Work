import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.14em]",
  {
    variants: {
      tone: {
        neutral: "bg-cocoa-700 text-cream",
        electric: "bg-electric/20 text-electric-soft",
        jackson: "bg-jackson/20 text-jackson-soft",
        vibrant: "bg-vibrant text-cocoa-950",
        danger: "bg-hotpink/25 text-hotpink-soft",
        outline: "border border-cocoa-600 text-cream-dim"
      }
    },
    defaultVariants: { tone: "neutral" }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
