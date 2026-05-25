import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vibrant disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-vibrant text-cocoa-950 hover:bg-vibrant-soft shadow-glow",
        electric:
          "bg-electric text-cream hover:bg-electric-soft",
        jackson:
          "bg-jackson text-cream hover:bg-jackson-soft",
        ghost:
          "bg-transparent text-cream hover:bg-cocoa-800",
        outline:
          "border border-cocoa-600 bg-cocoa-900/60 text-cream hover:bg-cocoa-800",
        danger:
          "bg-hotpink text-cocoa-950 hover:bg-hotpink-soft"
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-6 text-sm",
        lg: "h-14 px-8 text-base"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
