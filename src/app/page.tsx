"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Product } from "@/lib/products";
import { SearchBar } from "@/components/SearchBar";
import { ProductCard } from "@/components/ProductCard";
import { ProductGridSkeleton } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/States";

const SUGGESTIONS = ["AirPods Pro", "Nintendo Switch OLED", "Stanley tumbler 40 oz", "Kindle Paperwhite"];

type SearchResponse = { products: Product[]; dealCounts?: Record<string, number> };

function Shop() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";

  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!q) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Search failed");
        setData(json);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [q, reload]);

  const go = useCallback((query: string) => router.push(`/?q=${encodeURIComponent(query)}`), [router]);

  if (!q) {
    return (
      <section className="flex min-h-[70vh] flex-col items-center justify-center">
        <h1 className="text-center font-serif text-5xl tracking-tight sm:text-6xl">Find it for less.</h1>
        <p className="mt-3 text-center text-stone-500">Real prices from Amazon, eBay, Etsy, Best Buy, Walmart and Target.</p>
        <div className="mt-10 w-full max-w-2xl">
          <SearchBar size="lg" autoFocus onSearch={go} placeholder="What are you shopping for?" />
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
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
      </section>
    );
  }

  return (
    <section className="pt-2">
      <div className="mx-auto max-w-2xl">
        <SearchBar initial={q} onSearch={go} />
      </div>
      <div className="mt-8">
        {loading && (
          <>
            <div className="skeleton mb-5 h-5 w-48 rounded" />
            <ProductGridSkeleton />
          </>
        )}
        {error && <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />}
        {data && <Results key={q} query={q} products={data.products} dealCounts={data.dealCounts ?? {}} />}
      </div>
    </section>
  );
}

function Results({ query, products, dealCounts }: { query: string; products: Product[]; dealCounts: Record<string, number> }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [applied, setApplied] = useState<{ text: string; products: Product[] } | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterOpen) inputRef.current?.focus();
  }, [filterOpen]);

  async function runFilter(e: React.FormEvent) {
    e.preventDefault();
    const text = filterText.trim();
    if (!text) return;
    setFiltering(true);
    setFilterError(null);
    try {
      const r = await fetch("/api/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, products }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Filter failed");
      setApplied({ text, products: json.products });
      setFilterOpen(false);
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : "Filter failed");
    } finally {
      setFiltering(false);
    }
  }

  if (products.length === 0) {
    return <EmptyState title="No priced results" body={`We couldn't find a listing for “${query}” with a price we could verify. Try a more specific product name.`} />;
  }

  const shown = applied?.products ?? products;
  const vendors = new Set(shown.map((p) => p.vendor)).size;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <p className="text-sm text-stone-500">
          <span className="font-medium text-stone-900">{shown.length}</span> results from {vendors} store{vendors === 1 ? "" : "s"} · lowest price first
        </p>
        <div className="ml-auto flex items-center gap-2">
          {applied && (
            <button
              onClick={() => {
                setApplied(null);
                setFilterText("");
              }}
              className="flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1.5 text-xs text-stone-50 hover:bg-stone-700"
              title="Clear filter"
            >
              <span className="max-w-[16rem] truncate">{applied.text}</span>
              <span aria-hidden>✕</span>
            </button>
          )}
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition ${
              filterOpen ? "border-stone-900 bg-white" : "border-stone-200 bg-white hover:border-stone-400"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
            </svg>
            Filter
          </button>
        </div>
      </div>

      {filterOpen && (
        <form onSubmit={runFilter} className="fade-up mb-6 flex items-center gap-2 rounded-2xl border border-stone-200 bg-white p-2 pl-4">
          <input
            ref={inputRef}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="e.g. new only, under $200, from Best Buy or Amazon"
            className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400"
          />
          <button
            disabled={filtering}
            className="shrink-0 rounded-xl bg-stone-900 px-4 py-2 text-sm text-stone-50 hover:bg-stone-700 disabled:opacity-60"
          >
            {filtering ? "Applying…" : "Apply"}
          </button>
        </form>
      )}
      {filterError && <p className="-mt-3 mb-5 text-sm text-red-700">{filterError}</p>}

      {shown.length === 0 ? (
        <EmptyState title="Nothing matches that filter" body="Try loosening it, or clear it to see every result." />
      ) : (
        <div className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-4 ${filtering ? "opacity-50" : ""}`}>
          {shown.map((p, i) => (
            <ProductCard key={p.id} p={p} index={i} dealCount={dealCounts[p.vendor] ?? 0} />
          ))}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Shop />
    </Suspense>
  );
}
