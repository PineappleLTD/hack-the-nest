export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center">
      <p className="font-serif text-2xl">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{body}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/60 px-6 py-10 text-center">
      <p className="font-medium text-red-900">Something went wrong</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 rounded-full bg-red-900 px-4 py-1.5 text-sm text-white hover:bg-red-800">
          Try again
        </button>
      )}
    </div>
  );
}
