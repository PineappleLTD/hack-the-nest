export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="border-t border-line py-16 text-center">
      <p className="text-xl font-light tracking-[-0.02em] text-foreground">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border-t border-line py-16 text-center">
      <p className="text-xl font-light tracking-[-0.02em] text-foreground">That search didn&rsquo;t go through</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 h-9 rounded-md border border-input px-4 text-[13px] text-foreground transition-colors hover:border-[#4a4a47]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
