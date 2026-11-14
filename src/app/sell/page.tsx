"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketReport, PriceCheck } from "@/lib/listings";
import { money } from "@/lib/format";
import { VendorBadge } from "@/components/VendorBadge";
import { RowsSkeleton } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/States";

const CONDITIONS = ["New", "Like new", "Good", "Fair", "For parts"];
const FB_CREATE_URL = "https://www.facebook.com/marketplace/create/item";

type Result = PriceCheck & { photoUrl: string | null };

export default function SellPage() {
  const [item, setItem] = useState("");
  const [condition, setCondition] = useState("Good");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!item.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.set("item", item.trim());
    form.set("condition", condition);
    form.set("notes", notes);
    if (photo) form.set("photo", photo);
    try {
      const r = await fetch("/api/price-check", { method: "POST", body: form });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Price check failed");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Price check failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="pt-6">
      <div className="max-w-2xl">
        <h1 className="font-serif text-5xl tracking-tight">Sell something.</h1>
        <p className="mt-2 text-stone-500">See what it actually sells for on eBay, Mercari and Facebook Marketplace, then post in a click.</p>
      </div>

      <form onSubmit={submit} className="mt-8 grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 sm:grid-cols-[1fr_auto] sm:p-6">
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Item</span>
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="iPhone 13, 128GB, Midnight"
              className="rounded-xl border border-stone-200 px-4 py-2.5 outline-none transition focus:border-stone-400"
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Condition</span>
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setCondition(c)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                    condition === c ? "border-stone-900 bg-stone-900 text-stone-50" : "border-stone-200 hover:border-stone-400"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Battery 89%, includes box and cable, small scratch on back"
              className="resize-none rounded-xl border border-stone-200 px-4 py-2.5 outline-none transition focus:border-stone-400"
            />
          </label>
        </div>
        <div className="flex flex-col gap-4 sm:w-56">
          <label className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-sm text-stone-500 transition hover:border-stone-400">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-36 rounded-lg object-contain" />
            ) : (
              <>
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Add a photo
                <span className="text-xs text-stone-400">optional</span>
              </>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          <button
            disabled={loading || !item.trim()}
            className="rounded-xl bg-stone-900 px-4 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "Checking prices…" : "Price it"}
          </button>
        </div>
      </form>

      <div className="mt-10">
        {loading && (
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <RowsSkeleton key={i} count={2} />
            ))}
          </div>
        )}
        {error && <ErrorState message={error} onRetry={() => submit()} />}
        {result && <Markets result={result} />}
      </div>
    </section>
  );
}

function Markets({ result }: { result: Result }) {
  const anyComps = result.markets.some((m) => m.comps.length > 0);
  return (
    <>
      {!anyComps && (
        <div className="mb-6">
          <EmptyState
            title="No comparable listings found"
            body="We only show prices we can link to, so there's no recommendation yet. Try a more specific name (brand, model, size)."
          />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {result.markets.map((m, i) => (
          <MarketCard key={m.market} m={m} index={i} result={result} />
        ))}
      </div>
    </>
  );
}

function MarketCard({ m, result, index }: { m: MarketReport; result: Result; index: number }) {
  const [price, setPrice] = useState(m.recommended != null ? m.recommended.toFixed(2) : "");
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description);
  const [copied, setCopied] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const [action, setAction] = useState<{ busy?: string; link?: { label: string; url: string }; error?: string }>({});

  const listingText = `${title}\n\n${price ? `Price: ${money(Number(price))}\n\n` : ""}${description}`;

  async function copy() {
    await navigator.clipboard.writeText(listingText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function post(kind: "ebay" | "stripe") {
    setAction({ busy: kind });
    try {
      const r = await fetch(kind === "ebay" ? "/api/ebay/list" : "/api/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "ebay"
            ? { title, description, price: Number(price), condition: result.input.condition, imageUrls: result.photoUrl ? [location.origin + result.photoUrl] : [] }
            : { name: title, price: Number(price) },
        ),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error);
      setAction({ link: { label: kind === "ebay" ? "View on eBay" : "Payment link", url: json.url } });
    } catch (err) {
      setAction({ error: err instanceof Error ? err.message : "Failed" });
    }
  }

  return (
    <article className="fade-up flex flex-col rounded-3xl border border-stone-200 bg-white p-5" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-center justify-between">
        <VendorBadge id={m.market} name={m.marketName} />
        <span className="text-xs text-stone-500">
          {m.comps.length} comp{m.comps.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Recommended</p>
        {m.recommended != null ? (
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl text-stone-400">$</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full bg-transparent text-4xl font-semibold tracking-tight outline-none"
            />
          </div>
        ) : (
          <p className="mt-1 text-sm text-stone-500">Not enough comps on {m.marketName} to recommend a price.</p>
        )}
        {m.low != null && m.high != null && (
          <p className="mt-1 text-sm text-stone-500">
            Sells for {money(m.low)}
            {m.high !== m.low && <> – {money(m.high)}</>}
            {m.median != null && m.comps.length > 2 && <> · median {money(m.median)}</>}
          </p>
        )}
      </div>

      {m.comps.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowComps((s) => !s)} className="text-xs font-medium text-stone-600 underline-offset-4 hover:underline">
            {showComps ? "Hide" : "Show"} comparable listings
          </button>
          {showComps && (
            <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-100">
              {m.comps.map((c) => (
                <li key={c.id}>
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-stone-50">
                    <span className="line-clamp-1 flex-1 text-stone-700">{c.title}</span>
                    <span className="font-medium">{money(c.price)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-2 border-t border-stone-100 pt-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-lg border border-transparent px-2 py-1 -mx-2 font-medium outline-none hover:border-stone-200 focus:border-stone-300"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={7}
          className="-mx-2 resize-none rounded-lg border border-transparent px-2 py-1 text-sm leading-relaxed text-stone-600 outline-none hover:border-stone-200 focus:border-stone-300"
        />
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <button onClick={copy} className="rounded-full bg-stone-900 px-4 py-2 text-sm text-stone-50 hover:bg-stone-700">
          {copied ? "Copied ✓" : "Copy listing"}
        </button>
        {m.market === "ebay" && result.ebayEnabled && (
          <button
            onClick={() => post("ebay")}
            disabled={!!action.busy || !Number(price)}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm hover:border-stone-500 disabled:opacity-50"
          >
            {action.busy === "ebay" ? "Posting…" : "Post to eBay"}
          </button>
        )}
        {m.market === "facebook" && (
          <a
            href={FB_CREATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={copy}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm hover:border-stone-500"
          >
            Open Marketplace ↗
          </a>
        )}
        {m.market === "mercari" && (
          <a
            href="https://www.mercari.com/sell/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={copy}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm hover:border-stone-500"
          >
            Open Mercari ↗
          </a>
        )}
        {result.stripeEnabled && (
          <button
            onClick={() => post("stripe")}
            disabled={!!action.busy || !Number(price)}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm hover:border-stone-500 disabled:opacity-50"
          >
            {action.busy === "stripe" ? "Creating…" : "Payment link"}
          </button>
        )}
      </div>
      {action.link && (
        <a href={action.link.url} target="_blank" rel="noopener noreferrer" className="mt-3 break-all text-sm text-emerald-700 underline underline-offset-4">
          {action.link.label}: {action.link.url}
        </a>
      )}
      {action.error && <p className="mt-3 text-sm text-red-700">{action.error}</p>}
    </article>
  );
}
