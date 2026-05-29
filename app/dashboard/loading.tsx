import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-cocoa-950 p-8 space-y-8">
      {/* ScreenHeader */}
      <div className="space-y-3">
        <Skeleton className="h-9 w-72 rounded-2xl" />
        <Skeleton className="h-4 w-96 rounded-xl bg-cocoa-800/40" />
      </div>

      {/* KPI cards row */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-3xl border border-cocoa-700 bg-cocoa-900/80 p-7 space-y-4"
          >
            <Skeleton className="h-4 w-24 rounded-xl bg-cocoa-800/40" />
            <Skeleton className="h-9 w-32 rounded-2xl" />
            <Skeleton className="h-3 w-40 rounded-xl bg-cocoa-800/40" />
          </div>
        ))}
      </div>

      {/* Large data table / chart placeholder */}
      <div className="rounded-3xl border border-cocoa-700 bg-cocoa-900/80 p-7 space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48 rounded-2xl" />
          <Skeleton className="h-9 w-28 rounded-2xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-1/4 rounded-xl bg-cocoa-800/40" />
              <Skeleton className="h-4 w-1/3 rounded-xl bg-cocoa-800/40" />
              <Skeleton className="h-4 w-1/6 rounded-xl bg-cocoa-800/40" />
              <Skeleton className="ml-auto h-4 w-16 rounded-xl bg-cocoa-800/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
