"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CartGlassReveal } from "@/components/ui/liquid-glass-logo-reveal";
import SearchWithCategory, { type SearchMode } from "@/components/ui/search-with-category";
import { STARTED_KEY } from "@/lib/started";
import { ShopResults } from "@/components/ShopResults";
import { SellResults } from "@/components/SellResults";

// three.js loads as its own chunk, after the page is interactive.
const DustField = dynamic(() => import("@/components/DustField").then((m) => m.DustField), { ssr: false });

const HEADLINE: Record<SearchMode, string> = {
  shop: "find it for less",
  sell: "sell it for more",
};
// Typing runs the search once it pauses this long; Enter runs it right away.
const PAUSE_MS = 1000;
const MIN_CHARS = 3;

function href(q: string, mode: SearchMode) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (mode === "sell") p.set("mode", "sell");
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

function Home() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const urlMode: SearchMode = params.get("mode") === "sell" ? "sell" : "shop";

  const [mode, setMode] = useState<SearchMode>(urlMode);
  const [text, setText] = useState(query);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const active = query !== "";
  const width = active ? "max-w-3xl" : "max-w-2xl";

  const run = useCallback((q: string, m: SearchMode) => router.replace(href(q, m), { scroll: false }), [router]);

  // Search as you type: once typing pauses, or straight away when the box is cleared.
  useEffect(() => {
    const q = text.trim();
    if (q === query && mode === urlMode) return;
    if (q && q.length < MIN_CHARS) return;
    const t = setTimeout(() => run(q, mode), q ? PAUSE_MS : 0);
    return () => clearTimeout(t);
  }, [text, mode, query, urlMode, run]);

  // First visit: the landing's button reveals the search, and we remember it was used.
  const getStarted = () => {
    try {
      localStorage.setItem(STARTED_KEY, "1");
    } catch {}
    document.documentElement.toggleAttribute("data-started", true);
    document.querySelector<HTMLInputElement>("form[role=search] input[type=text]")?.focus({ preventScroll: true });
  };

  // Stripe onboarding runs in its own tab and comes back here.
  const stripe = params.get("stripe");
  if (stripe) return <StripeReturn ok={stripe === "return"} message={params.get("message")} />;

  return (
    <>
      <DustField dim={active} stir={busy} />

      <section className="flex flex-col items-center">
        {/* The hero folds away once there are results to show. */}
        <div
          className="grid w-full transition-[grid-template-rows,opacity] duration-700 ease-out-expo"
          style={{ gridTemplateRows: active ? "0fr" : "1fr", opacity: active ? 0 : 1 }}
          aria-hidden={active}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="hero-stage">
              <CartGlassReveal tileSize={280} className="hero-glass w-full max-w-[560px] mix-blend-screen" />

              {/* First visit only: a big way in once the cart has arrived. */}
              <div className="landing-cta w-full">
                <div className="min-h-0 overflow-hidden px-5 pb-12 pt-6">
                  <button
                    onClick={getStarted}
                    className="gold-button cta-in mx-auto flex h-20 w-full max-w-md items-center justify-center rounded-full text-2xl font-semibold tracking-[-0.01em] text-white sm:h-24 sm:text-[28px]"
                  >
                    Shop
                  </button>
                </div>
              </div>

              <div className="home-fold w-full">
                <div className="min-h-0 overflow-hidden">
                  <h1 className="pb-10 text-center text-[clamp(40px,6.4vw,64px)] font-light leading-[1.05] tracking-[-0.035em] text-foreground/90">
                    {HEADLINE[mode]}
                  </h1>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`home-only sticky top-3 z-30 w-full transition-[max-width] duration-700 ease-out-expo ${width}`}
        >
          <SearchWithCategory
            mode={mode}
            onModeChange={(m) => {
              setMode(m);
              setPhoto(null);
            }}
            value={text}
            onValueChange={setText}
            onSubmit={() => {
              const q = text.trim();
              if (q) run(q, mode);
            }}
            busy={busy}
            photo={photo}
            onPhotoChange={setPhoto}
            autoFocus
          />
        </div>
      </section>

      {active && (
        <div className={`mx-auto mt-6 ${width}`}>
          {urlMode === "shop" ? (
            <ShopResults key={query} query={query} onBusy={setBusy} />
          ) : (
            <SellResults key={query} item={query} photo={photo} onBusy={setBusy} />
          )}
        </div>
      )}
    </>
  );
}

/** The tab Stripe sends the seller back to: close it if we can, since the listing waits in the tab they came from. */
function StripeReturn({ ok, message }: { ok: boolean; message: string | null }) {
  useEffect(() => {
    if (ok) window.close();
  }, [ok]);
  return (
    <div className="flex min-h-[80svh] flex-col items-center justify-center text-center">
      <h1 className="text-[clamp(32px,5vw,48px)] font-light leading-[1.1] tracking-[-0.035em] text-foreground/90">
        {ok ? "Back from Stripe" : "Stripe didn't connect"}
      </h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        {ok ? "Close this tab and return to your listing." : (message ?? "Something went wrong on the way back from Stripe.")}
      </p>
      {!ok && (
        <a
          href="/api/stripe/connect/start"
          className="mt-8 flex h-12 items-center rounded-md bg-brand px-6 text-[15px] font-medium text-black transition-colors hover:bg-[#ff7440]"
        >
          Try again
        </a>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
