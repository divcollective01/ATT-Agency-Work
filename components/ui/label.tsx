import * as React from "react";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-xs uppercase tracking-[0.18em] text-cream-mute font-medium",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
