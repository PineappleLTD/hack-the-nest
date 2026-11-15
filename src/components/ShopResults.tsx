"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowUpRight, Check, Copy, Package, SlidersHorizontal, X } from "lucide-react";
import type { Product } from "@/lib/products";
import type { Deal } from "@/lib/deals";
import { bestDeal, type AppliedDeal } from "@/lib/discount";
import { money } from "@/lib/format";
import { ResultRowsSkeleton } from "./Skeletons";
import { EmptyState, ErrorState } from "./States";

const CONDITION: Record<string, string> = { new: "New", used: "Used", refurbished: "Refurbished", unknown: "" };

// Deals are looked up once per store per visit; every later search reuses them.
const dealCache = new Map<string, Deal[]>();
const dealLookups = new Map<string, Promise<void>>();

function lookUpDeals(stores: string[]) {
  const todo = stores.filter((s) => !dealCache.has(s) && !dealLookups.has(s));
  if (todo.length) {
    const job = fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stores: todo }),
    })
      .then((r) => (r.ok ? r.json() : { deals: {} }))
      .then((json: { deals: Record<string, Deal[]> }) => todo.forEach((s) => dealCache.set(s, json.deals?.[s] ?? [])))
      .catch(() => todo.forEach((s) => dealCache.set(s, [])))
      .finally(() => todo.forEach((s) => dealLookups.delete(s)));
    todo.forEach((s) => dealLookups.set(s, job));
  }
  return Promise.all(stores.map((s) => dealLookups.get(s))).then(() =>
    Object.fromEntries(stores.map((s) => [s, dealCache.get(s) ?? []])),
  );
}

// Re-render inside a view transition when the browser has one, so rows glide to their new places.
function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    doc.startViewTransition(() => flushSync(update));
  } else update();
}

type SearchEvent =
  | { type: "product"; product: Product }
  | { type: "done"; products: Product[] }
  | { type: "error"; error: string };

// Products stream in one by one; they're shown in small batches so rows glide in together.
const BATCH_MS = 250;

export function ShopResults({ query, onBusy }: { query: string; onBusy: (busy: boolean) => void }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [deals, setDeals] = useState<Record<string, Deal[]>>({});

  useEffect(() => {
    const ctrl = new AbortController();
    const found: Product[] = [];
    let batch = 0;
    let finished = false;
    const show = () => {
      batch = 0;
      const next = [...found];
      withTransition(() => setProducts(next));
    };
    const finish = (list: Product[]) => {
      finished = true;
      clearTimeout(batch);
      withTransition(() => setProducts(list));
      setDone(true);
    };
    const handle = (event: SearchEvent) => {
      if (event.type === "product") {
        found.push(event.product);
        batch ||= window.setTimeout(show, BATCH_MS);
      } else if (event.type === "done") finish(event.products);
      else if (event.type === "error") throw new Error(event.error);
    };

    setError(null);
    setProducts(null);
    setDone(false);
    onBusy(true);
    (async () => {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, stream: true }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        const json = await r.json().catch(() => ({}));
        throw new Error(json.error ?? "Search failed");
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { value, done: ended } = await reader.read();
        buffered += decoder.decode(value, { stream: !ended });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as SearchEvent);
        if (ended) break;
      }
      // The connection closed without a final list: keep what arrived.
      if (!finished) finish(found);
    })()
      .catch((e) => {
        if (e.name === "AbortError") return;
        // Something broke partway: keep the prices already found rather than replace them with an error.
        if (found.length) finish(found);
        else setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) onBusy(false);
      });
    return () => {
      ctrl.abort();
      clearTimeout(batch);
      onBusy(false);
    };
  }, [query, reload, onBusy]);

  // Deals for the stores near the top of the final list, found automatically.
  useEffect(() => {
    if (!done || !products?.length) return;
    let live = true;
    const stores = [...new Set(products.slice(0, 6).map((p) => p.vendor))];
    lookUpDeals(stores).then((found) => {
      if (live && Object.values(found).some((d) => d.length)) withTransition(() => setDeals(found));
    });
    return () => {
      live = false;
    };
  }, [products, done]);

  if (error) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!products || (!products.length && !done)) return <ResultRowsSkeleton />;
  if (products.length === 0)
    return (
      <EmptyState
        title={`No prices found for “${query}”`}
        body="We only list prices we can read on the store's own page. Try the exact product name, like the brand and model."
      />
    );
  return <Results key={query} products={products} deals={deals} streaming={!done} />;
}

type Row = { p: Product; applied: AppliedDeal | null; deal: Deal | null; price: number };

function Results({ products, deals, streaming }: { products: Product[]; deals: Record<string, Deal[]>; streaming: boolean }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [applied, setApplied] = useState<{ text: string; products: Product[] } | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterOpen) inputRef.current?.focus();
  }, [filterOpen]);

  const rows: Row[] = useMemo(() => {
    const shown = applied?.products ?? products;
    return shown
      .map((p) => {
        const storeDeals = deals[p.vendor] ?? [];
        const best = bestDeal(p.price, storeDeals);
        return { p, applied: best, deal: best?.deal ?? storeDeals.find((d) => d.code) ?? null, price: best?.price ?? p.price };
      })
      .sort((a, b) => a.price - b.price);
  }, [products, applied, deals]);

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

  return (
    <>
      <div className="mb-2 flex min-h-9 items-center justify-end gap-2">
        {applied && (
          <button
            onClick={() => {
              setApplied(null);
              setFilterText("");
            }}
            className="flex h-8 max-w-[18rem] items-center gap-2 rounded-md bg-white/10 px-3 text-[13px] text-foreground transition-colors hover:bg-white/15"
            aria-label={`Clear filter: ${applied.text}`}
          >
            <span className="truncate">{applied.text}</span>
            <X className="h-3.5 w-3.5 shrink-0" />
          </button>
        )}
        {/* Filtering waits for the full list, so it never judges a half-loaded one. */}
        {!streaming && (
          <button
            onClick={() => setFilterOpen((o) => !o)}
            aria-expanded={filterOpen}
            className={`flex h-8 items-center gap-2 rounded-md px-3 text-[13px] transition-colors animate-in fade-in duration-300 ${
              filterOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filter
          </button>
        )}
      </div>

      {filterOpen && (
        <form
          onSubmit={runFilter}
          className="mb-4 flex h-11 items-center gap-2 rounded-md border border-input bg-black/70 pl-4 pr-1.5 backdrop-blur-md animate-in fade-in slide-in-from-top-1 duration-300 focus-within:border-brand/70"
        >
          <input
            ref={inputRef}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="New only, under $200, from Best Buy or Amazon"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            disabled={filtering}
            className="h-8 shrink-0 rounded-sm bg-brand px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-[#ff7440] disabled:opacity-60"
          >
            {filtering ? "Filtering…" : "Filter"}
          </button>
        </form>
      )}
      {filterError && <p className="mb-4 text-sm text-destructive">{filterError}</p>}

      {rows.length === 0 ? (
        <EmptyState title="Nothing matches that filter" body="Loosen it, or clear it to see every result." />
      ) : (
        <ul aria-busy={streaming} className={`border-t border-line transition-opacity ${filtering ? "opacity-50" : ""}`}>
          {rows.map((row, i) => (
            <ResultRow key={row.p.id} row={row} index={i} cheapest={i === 0} />
          ))}
          {/* More stores are still being read. */}
          {streaming && (
            <li aria-hidden="true" className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:gap-5">
              <div className="skeleton aspect-square rounded-md" />
              <div className="space-y-2">
                <div className="skeleton h-3.5 w-2/3 rounded-sm" />
                <div className="skeleton h-3 w-1/4 rounded-sm" />
              </div>
              <div className="skeleton h-5 w-16 rounded-sm" />
            </li>
          )}
        </ul>
      )}
    </>
  );
}

function rowName(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return `row-${(h >>> 0).toString(36)}`;
}

function ResultRow({ row, index, cheapest }: { row: Row; index: number; cheapest: boolean }) {
  const { p, applied, deal, price } = row;
  const [imgOk, setImgOk] = useState(Boolean(p.imageUrl));
  return (
    <li
      className="rise group relative grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:gap-5"
      style={{ animationDelay: `${Math.min(index, 10) * 45}ms`, viewTransitionName: rowName(p.id) }}
    >
      <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-well p-1.5">
        {imgOk && p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
            className="h-full w-full object-contain mix-blend-multiply"
          />
        ) : (
          <Package className="h-5 w-5 text-[#b9b9b3]" strokeWidth={1.5} />
        )}
      </div>

      <div className="min-w-0">
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-[15px] leading-snug text-foreground/90 outline-none transition-colors after:absolute after:inset-0 group-hover:text-foreground focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-brand"
        >
          {p.title}
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span>{p.vendorName}</span>
          {CONDITION[p.condition] && <span>{CONDITION[p.condition]}</span>}
          {deal && <DealCode deal={deal} applied={applied} />}
        </div>
      </div>

      <div className="text-right tabular-nums">
        <div className={`text-xl font-medium tracking-tight ${cheapest ? "text-brand" : "text-foreground"}`}>{money(price)}</div>
        {applied && <div className="text-[13px] text-muted-foreground line-through">{money(p.price)}</div>}
      </div>
    </li>
  );
}

/**
 * A store's code. Applied, it shows what it saved; otherwise it's a code to try at checkout, since we only change
 * a price when the store's own site says the code is sitewide. Either way it links to where it was found.
 */
function DealCode({ deal, applied }: { deal: Deal; applied: AppliedDeal | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 animate-in fade-in duration-500">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(deal.code!);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        title={`${deal.description} Copy code`}
        className={`flex items-center gap-1.5 rounded-sm transition-colors ${
          applied ? "text-brand" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {!applied && <span>Try</span>}
        <span className="font-medium tracking-wide">{deal.code}</span>
        <span>{applied ? `saves ${money(applied.saved)}` : deal.discountText}</span>
      </button>
      <a
        href={deal.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-0.5 rounded-sm text-muted-foreground underline decoration-[#4a4a47] underline-offset-4 transition-colors hover:text-foreground"
      >
        {deal.sourceHost}
        <ArrowUpRight className="h-3 w-3" />
      </a>
    </span>
  );
}
