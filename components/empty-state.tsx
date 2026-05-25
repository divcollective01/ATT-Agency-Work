import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  body,
  action,
  className
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-dashed border-cocoa-600 bg-cocoa-900/40 p-10 text-center",
        "flex flex-col items-center",
        className
      )}
    >
      {icon && (
        <div className="size-14 rounded-2xl bg-cocoa-800 text-vibrant flex items-center justify-center mb-5">
          {icon}
        </div>
      )}
      <h3 className="font-display text-2xl tracking-tight">{title}</h3>
      {body && (
        <p className="text-sm text-cream-mute mt-2 max-w-md leading-relaxed">{body}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
