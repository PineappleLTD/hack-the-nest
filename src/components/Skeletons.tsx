export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white">
          <div className="skeleton aspect-square" />
          <div className="space-y-2.5 p-4">
            <div className="skeleton h-4 w-16 rounded-full" />
            <div className="skeleton h-3.5 w-full rounded" />
            <div className="skeleton h-3.5 w-2/3 rounded" />
            <div className="skeleton mt-3 h-6 w-20 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-stone-200/80 bg-white p-5">
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3.5 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
