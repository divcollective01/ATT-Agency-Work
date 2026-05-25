import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-12 w-full rounded-2xl border border-cocoa-600 bg-cocoa-900 px-4 py-2",
        "text-cream placeholder:text-cream-mute",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vibrant focus-visible:border-vibrant",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
