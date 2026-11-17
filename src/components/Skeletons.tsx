export function ResultRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Searching stores" className="mt-11 border-t border-line">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="grid grid-cols-[56px_1fr_auto] items-center gap-4 border-b border-line py-4 sm:grid-cols-[72px_1fr_auto] sm:gap-5" style={{ opacity: 1 - i * 0.13 }}>
          <div className="skeleton aspect-square rounded-md" />
          <div className="space-y-2.5">
            <div className="skeleton h-3.5 w-4/5 rounded-sm" />
            <div className="skeleton h-3 w-1/3 rounded-sm" />
          </div>
          <div className="skeleton h-5 w-16 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

export function MarketsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Checking resale prices" className="border-t border-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-x-10 gap-y-6 border-b border-line py-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <div className="skeleton h-3.5 w-24 rounded-sm" />
            <div className="skeleton h-10 w-36 rounded-sm" />
            <div className="skeleton h-3 w-44 rounded-sm" />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-3.5 w-full rounded-sm" />
            <div className="skeleton h-3 w-11/12 rounded-sm" />
            <div className="skeleton h-3 w-4/5 rounded-sm" />
            <div className="skeleton h-3 w-3/5 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
