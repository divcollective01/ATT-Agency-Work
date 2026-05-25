import * as React from "react";
import { cn } from "@/lib/utils";

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-12 w-full appearance-none rounded-2xl border border-cocoa-600 bg-cocoa-900 px-4 pr-10 py-2",
      "text-cream transition-colors hover:bg-cocoa-800",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vibrant focus-visible:border-vibrant",
      "bg-[length:14px_14px] bg-[right_1rem_center] bg-no-repeat",
      "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23A8927A%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export { Select };
