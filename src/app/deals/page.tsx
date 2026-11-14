"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Deal } from "@/lib/deals";
import { vendorById } from "@/lib/vendors";
import { timeAgo } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { RowsSkeleton } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/States";

const SUGGESTIONS = ["Best Buy", "Target", "Nike", "Walmart"];

function Deals() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const store = params.get("store")?.trim() ?? "";

  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!q && !store) {
      setDeals(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setDeals(null);
    const req = q
      ? fetch("/api/deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: ctrl.signal,
        })
      : fetch(`/api/deals?store=${encodeURIComponent(store)}`, { signal: ctrl.signal });
    req
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Couldn't load deals");
        setDeals(json.deals);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [q, store, reload]);

  const go = useCallback((query: string) => router.push(`/deals?q=${encodeURIComponent(query)}`), [router]);
  const label = q || vendorById(store)?.name || store;

  return (
    <section className="pt-6">
      <div className="max-w-2xl">
        <h1 className="font-serif text-5xl tracking-tight">Deals, with receipts.</h1>
        <p className="mt-2 text-stone-500">
          Coupon codes and sales for any store, each linked to where we found it. No affiliate links, no tracking.
        </p>
      </div>
      <div className="mt-8 max-w-2xl">
        <SearchBar initial={label} onSearch={go} placeholder="A store or product, e.g. Best Buy" />
        {!q && !store && (
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => go(s)}
                className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm text-stone-600 transition hover:border-stone-400 hover:text-stone-900"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-10 max-w-3xl">
        {loading && <RowsSkeleton count={5} />}
        {error && <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />}
        {deals && deals.length === 0 && (
          <EmptyState
            title="No verified deals right now"
            body={
              q
                ? `We didn't find any current codes for “${q}” that we could link to a source.`
                : `No saved deals for ${label} yet. Search for it to look for fresh ones.`
            }
          />
        )}
        {deals && deals.length > 0 && (
          <>
            <p className="mb-4 text-sm text-stone-500">
              <span className="font-medium text-stone-900">{deals.length}</span> deal{deals.length === 1 ? "" : "s"} for {label}
              {store && !q && (
                <>
                  {" · "}
                  <button onClick={() => go(label)} className="underline underline-offset-4 hover:text-stone-900">
                    look for more
                  </button>
                </>
              )}
            </p>
            <ul className="space-y-3">
              {deals.map((d, i) => (
                <DealRow key={d.id} d={d} index={i} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function DealRow({ d, index }: { d: Deal; index: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <li
      className="fade-up flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:flex-row sm:items-center"
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xl font-semibold tracking-tight">{d.discountText}</span>
          <span className="text-sm text-stone-500">{d.store}</span>
        </div>
        <p className="mt-1 text-sm text-stone-700">{d.description}</p>
        <p className="mt-2 text-xs text-stone-500">
          Found on{" "}
          <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-stone-700 underline underline-offset-4 hover:text-stone-900">
            {d.sourceHost}
          </a>{" "}
          · {timeAgo(d.foundAt)}
          {d.expiresAt && (
            <> · expires {new Date(d.expiresAt + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</>
          )}
        </p>
      </div>
      {d.code ? (
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(d.code!);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="group flex shrink-0 items-center gap-3 rounded-xl border border-dashed border-stone-400 bg-stone-50 px-4 py-2.5 font-mono text-sm tracking-wider transition hover:border-stone-900"
          title="Copy code"
        >
          {d.code}
          <span className="font-sans text-xs tracking-normal text-stone-500 group-hover:text-stone-900">{copied ? "Copied ✓" : "Copy"}</span>
        </button>
      ) : (
        <a
          href={d.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-xl border border-stone-200 px-4 py-2.5 text-sm text-stone-600 transition hover:border-stone-400 hover:text-stone-900"
        >
          No code needed ↗
        </a>
      )}
    </li>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Deals />
    </Suspense>
  );
}
