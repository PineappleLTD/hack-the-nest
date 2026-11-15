import { z } from "zod";
import { webSearch } from "./exa";
import { mapSettled, tryStructured } from "./llm";
import { extractProduct, type Product } from "./products";
import { RESALE_MARKETS, vendorForUrl } from "./vendors";
import { cached } from "./db";

export type SellInput = {
  item: string;
  condition: string;
  notes?: string;
};

export type MarketReport = {
  market: string; // vendor id
  marketName: string;
  comps: Product[];
  low: number | null;
  high: number | null;
  median: number | null;
  recommended: number | null;
  title: string;
  description: string;
};

export type PriceCheck = {
  input: SellInput;
  markets: MarketReport[];
  ebayEnabled: boolean;
  stripeEnabled: boolean;
};

const MARKET_QUERY: Record<string, (item: string) => string> = {
  ebay: (item) => `${item} listing`,
  mercari: (item) => `${item} for sale`,
  facebook: (item) => `${item} marketplace for sale`,
};

const MARKET_DOMAINS: Record<string, string[]> = {
  ebay: ["ebay.com"],
  mercari: ["mercari.com"],
  facebook: ["facebook.com"],
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A touch under the lowest credible comp, ending in .99 for a quick sale. */
export function recommendPrice(prices: number[]): number | null {
  if (!prices.length) return null;
  const med = median(prices);
  // Ignore extreme low outliers (broken / parts-only listings that slipped through).
  const credible = prices.filter((p) => p >= med * 0.4);
  const lowest = Math.min(...credible);
  const target = Math.floor(lowest * 0.97) - 0.01;
  return Math.max(0.99, Number(target.toFixed(2)));
}

const ListingCopySchema = z.object({
  listings: z.array(
    z.object({
      market: z.enum(RESALE_MARKETS.map((m) => m.id) as [string, ...string[]]),
      title: z.string(),
      description: z.string(),
    }),
  ),
});

const COPY_SYSTEM = `You write resale listings. Write one listing per marketplace requested.
- Only state facts the seller gave you. Never invent specs, accessories, battery health, or history.
- eBay: title max 80 characters, keyword-rich (brand, model, capacity, color, condition). Description: short intro, bulleted details, condition notes, "Ships quickly" line.
- Mercari: title max 40 characters. Friendly, concise description with bullets.
- Facebook Marketplace: casual title, max 60 characters. Short, friendly description; mention local pickup is available.
- Plain text only (no markdown headings, no emojis). Use "- " for bullets.`;

async function writeListings(input: SellInput) {
  return tryStructured(
    "listing_copy",
    ListingCopySchema,
    COPY_SYSTEM,
    `Marketplaces: ${RESALE_MARKETS.map((m) => `${m.id} (${m.name})`).join(", ")}
Item: ${input.item}
Condition: ${input.condition}
Seller notes: ${input.notes?.trim() || "(none)"}`,
  );
}

function fallbackCopy(input: SellInput) {
  const title = `${input.item} - ${input.condition}`.slice(0, 80);
  const description = [`${input.item}`, `Condition: ${input.condition}`, input.notes?.trim()].filter(Boolean).join("\n");
  return { title, description };
}

async function findComps(input: SellInput, marketId: string): Promise<Product[]> {
  const query = MARKET_QUERY[marketId](`${input.item} ${input.condition}`);
  // Exa errors propagate so priceCheck can tell "no comps" apart from "search is broken".
  const pages = await webSearch(query, { includeDomains: MARKET_DOMAINS[marketId], numResults: 10, maxCharacters: 5000 });
  // Throws only if every page's extraction failed (bad key, outage); priceCheck decides whether to surface it.
  const results = await mapSettled(pages, 8, async (page) => {
    const vendor = vendorForUrl(page.url);
    if (!vendor || vendor.id !== marketId) return null;
    return extractProduct(page, input.item, vendor);
  });
  return results.filter((p): p is Product => p !== null).sort((a, b) => a.price - b.price);
}

export async function priceCheck(input: SellInput): Promise<PriceCheck> {
  const key = { item: input.item.trim().toLowerCase(), condition: input.condition, notes: input.notes?.trim() ?? "" };
  const markets = await cached(
    "price-check",
    key,
    async () => {
      if (!process.env.EXA_API_KEY) throw new Error("EXA_API_KEY is not set");
      const [settled, copy] = await Promise.all([
        Promise.allSettled(RESALE_MARKETS.map((m) => findComps(input, m.id))),
        writeListings(input),
      ]);
      const compsByMarket = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
      // A market that fails just shows no comps, unless nothing worked anywhere: then report the error.
      const failed = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
      failed.forEach((f) => console.error("[price-check]", f.reason instanceof Error ? f.reason.message : f.reason));
      if (failed.length && compsByMarket.every((c) => c.length === 0)) throw failed[0].reason;
      return RESALE_MARKETS.map((m, i): MarketReport => {
        const comps = compsByMarket[i];
        const prices = comps.map((c) => c.price);
        const c = copy?.listings.find((l) => l.market === m.id) ?? fallbackCopy(input);
        return {
          market: m.id,
          marketName: m.name,
          comps,
          low: prices.length ? Math.min(...prices) : null,
          high: prices.length ? Math.max(...prices) : null,
          median: prices.length ? median(prices) : null,
          recommended: recommendPrice(prices),
          title: c.title,
          description: c.description,
        };
      });
    },
    (ms) => ms.some((m) => m.comps.length > 0),
  );
  return {
    input,
    markets,
    ebayEnabled: Boolean(process.env.EBAY_OAUTH_TOKEN),
    stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
  };
}
