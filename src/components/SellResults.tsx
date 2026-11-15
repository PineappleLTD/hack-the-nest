"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import type { MarketReport, PriceCheck } from "@/lib/listings";
import { money } from "@/lib/format";
import { MarketsSkeleton } from "./Skeletons";
import { EmptyState, ErrorState } from "./States";

const CONDITIONS = ["New", "Like new", "Good", "Fair", "For parts"];
const OPEN_URL: Record<string, { label: string; url: string }> = {
  facebook: { label: "Open Marketplace", url: "https://www.facebook.com/marketplace/create/item" },
  mercari: { label: "Open Mercari", url: "https://www.mercari.com/sell/" },
};

// Facebook Marketplace isn't indexed, so its price is estimated from the other markets.
const WHY_NO_LISTINGS: Record<string, string> = {
  facebook: "Marketplace listings aren't publicly searchable.",
};
const names = new Intl.ListFormat("en", { type: "conjunction" });

type Result = PriceCheck & { photoUrl: string | null };
type Stripe = { configured: boolean; connected: boolean; detailsSubmitted: boolean };

export function SellResults({ item, photo, onBusy }: { item: string; photo: File | null; onBusy: (busy: boolean) => void }) {
  const [condition, setCondition] = useState("Good");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const stripeEnabled = result?.stripeEnabled ?? false;

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    setResult(null);
    onBusy(true);
    const form = new FormData();
    form.set("item", item);
    form.set("condition", condition);
    if (photo) form.set("photo", photo);
    fetch("/api/price-check", { method: "POST", body: form, signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Price check failed");
        setResult(json);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) onBusy(false);
      });
    return () => {
      ctrl.abort();
      onBusy(false);
    };
  }, [item, condition, photo, reload, onBusy]);

  // Whether payment links can go to this seller's own Stripe account. Onboarding runs in its own tab,
  // so check again when the seller comes back to this one.
  useEffect(() => {
    if (!stripeEnabled) return;
    const load = () =>
      fetch("/api/stripe/connect")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setStripe(s))
        .catch(() => {});
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [stripeEnabled]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
        <span className="text-[13px] text-muted-foreground">Condition</span>
        <div role="radiogroup" aria-label="Condition" className="flex rounded-md border border-input p-0.5">
          {CONDITIONS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={condition === c}
              onClick={() => setCondition(c)}
              className={`h-7 rounded-sm px-2.5 text-[13px] transition-colors ${
                condition === c ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />}
      {!error && !result && <MarketsSkeleton />}
      {result && <Markets result={result} stripe={stripe} />}
    </>
  );
}

function Markets({ result, stripe }: { result: Result; stripe: Stripe | null }) {
  if (!result.markets.some((m) => m.comps.length > 0))
    return (
      <EmptyState
        title="No comparable listings found"
        body="We only price from listings we can link to. Try a more specific name, like the brand, model and size."
      />
    );
  return (
    <div className="border-t border-line">
      {result.markets.map((m, i) => (
        <Market key={m.market} m={m} index={i} result={result} stripe={stripe} />
      ))}
    </div>
  );
}

function Market({ m, result, stripe, index }: { m: MarketReport; result: Result; stripe: Stripe | null; index: number }) {
  const [price, setPrice] = useState(m.recommended != null ? m.recommended.toFixed(2) : "");
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description);
  const [copied, setCopied] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const [action, setAction] = useState<{ busy?: string; link?: { label: string; url: string }; error?: string }>({});
  const open = OPEN_URL[m.market];

  async function copy() {
    await navigator.clipboard.writeText(`${title}\n\n${price ? `Price: ${money(Number(price))}\n\n` : ""}${description}`);
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
      setAction({ link: { label: kind === "ebay" ? "Listed on eBay" : "Payment link", url: json.url } });
    } catch (err) {
      setAction({ error: err instanceof Error ? err.message : `Couldn't ${kind === "ebay" ? "post to eBay" : "create the payment link"}` });
    }
  }

  const ghost = "h-9 rounded-md border border-input px-3.5 text-[13px] text-foreground transition-colors hover:border-[#4a4a47] disabled:opacity-50";

  return (
    <section className="rise border-b border-line py-8" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <div className="flex items-baseline justify-between text-[13px]">
            <h2 className="font-medium text-foreground">{m.marketName}</h2>
            {m.comps.length > 0 && (
              <span className="text-muted-foreground">
                {m.comps.length} listing{m.comps.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {m.recommended != null ? (
            <label className="mt-4 flex items-baseline gap-1">
              <span className="sr-only">Your price on {m.marketName}</span>
              <span className="text-2xl font-light text-muted-foreground">$</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="w-full bg-transparent text-[44px] font-light leading-none tracking-[-0.03em] tabular-nums text-foreground outline-none"
              />
            </label>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Not enough listings on {m.marketName} to suggest a price.</p>
          )}
          {m.low != null && m.high != null && (
            <p className="mt-2 text-[13px] tabular-nums text-muted-foreground">
              Sells for {money(m.low)}
              {m.high !== m.low && <> to {money(m.high)}</>}
              {m.median != null && m.comps.length > 2 && <>, median {money(m.median)}</>}
            </p>
          )}
          {m.estimatedFrom && m.comps.length === 0 && (
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Estimated from {names.format(m.estimatedFrom)} listings.{" "}
              {WHY_NO_LISTINGS[m.market] ?? `We found no ${m.marketName} listings to compare.`}
            </p>
          )}

          {m.comps.length > 0 && (
            <button
              onClick={() => setShowComps((s) => !s)}
              aria-expanded={showComps}
              className="mt-3 rounded-sm text-[13px] text-muted-foreground underline decoration-[#4a4a47] underline-offset-4 transition-colors hover:text-foreground"
            >
              {showComps ? "Hide listings" : "See the listings"}
            </button>
          )}
        </div>

        <div className="flex flex-col">
          <div className="grid gap-1">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              rows={2}
              aria-label={`Listing title for ${m.marketName}`}
              className="-mx-2 resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] font-medium leading-snug text-foreground outline-none transition-colors hover:border-input focus:border-brand/70"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              // Grows with the text where the browser can; elsewhere, tall enough for what was written.
              rows={Math.min(16, description.split("\n").length + 1)}
              aria-label={`Listing description for ${m.marketName}`}
              className="-mx-2 resize-none [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-muted-foreground outline-none transition-colors hover:border-input focus:border-brand/70 focus:text-foreground"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-4">
            <button onClick={copy} className="flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-[#ff7440]">
              {copied && <Check className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy listing"}
            </button>
            {m.market === "ebay" && result.ebayEnabled && (
              <button onClick={() => post("ebay")} disabled={!!action.busy || !Number(price)} className={ghost}>
                {action.busy === "ebay" ? "Posting…" : "Post to eBay"}
              </button>
            )}
            {open && (
              <a href={open.url} target="_blank" rel="noopener noreferrer" onClick={copy} className={`${ghost} flex items-center gap-1`}>
                {open.label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
            {result.stripeEnabled && stripe?.configured &&
              (stripe.connected && stripe.detailsSubmitted ? (
                <button onClick={() => post("stripe")} disabled={!!action.busy || !Number(price)} className={ghost}>
                  {action.busy === "stripe" ? "Creating…" : "Payment link"}
                </button>
              ) : (
                // Stripe's own pages collect the seller's address and bank details; a new tab keeps this listing as it is.
                <button onClick={() => window.open("/api/stripe/connect/start", "_blank")} className={`${ghost} flex items-center gap-1`}>
                  {stripe.connected ? "Finish Stripe setup" : "Connect Stripe"}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              ))}
          </div>
          {action.link && (
            <a href={action.link.url} target="_blank" rel="noopener noreferrer" className="mt-3 break-all text-[13px] text-brand underline underline-offset-4">
              {action.link.label}: {action.link.url}
            </a>
          )}
          {action.error && <p className="mt-3 text-[13px] text-destructive">{action.error}</p>}
        </div>
      </div>

      {showComps && (
        <ul className="mt-6 animate-in fade-in duration-300 border-t border-line">
          {m.comps.map((c) => (
            <li key={c.id}>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border-b border-line py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="line-clamp-1 flex-1">{c.title}</span>
                <span className="tabular-nums text-foreground">{money(c.price)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
