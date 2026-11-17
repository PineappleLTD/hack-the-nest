/**
 * A tiny fake web for the Exa fake: which URLs a domain search returns, and the text of each page.
 * Plus a fake product extractor that reads the price from the page text the app sends to Claude.
 */
import { exa, type ExaResponse, type SearchOptions } from "./exa-mock";

export type FakePage = {
  url: string;
  title: string;
  text: string;
  image?: string;
  /** Exa sometimes returns a canonical `url` that differs from the requested one (echoed as `id`). */
  canonicalUrl?: string;
};

export type FakeWeb = {
  /** Search hits per domain (the app always searches with includeDomains: [one domain]). */
  hits: Record<string, string[]>;
  pages: FakePage[];
};

export function installWeb(web: FakeWeb) {
  const byUrl = new Map(web.pages.map((p) => [p.url, p]));
  exa.search.mockImplementation(async (_query: string, opts?: SearchOptions): Promise<ExaResponse> => {
    const domain = opts?.includeDomains?.[0] ?? "";
    const urls = web.hits[domain] ?? [];
    return {
      results: urls.map((url) => ({ id: url, url, title: byUrl.get(url)?.title ?? url })),
      costDollars: { total: 0.005 },
    };
  });
  exa.getContents.mockImplementation(async (urls: string[]): Promise<ExaResponse> => ({
    results: urls.flatMap((u) => {
      const p = byUrl.get(u);
      return p ? [{ id: u, url: p.canonicalUrl ?? u, title: p.title, text: p.text, ...(p.image ? { image: p.image } : {}) }] : [];
    }),
    costDollars: { total: 0.001 * urls.length },
  }));
  return byUrl;
}

/** URLs passed to every getContents call so far, flattened. */
export function fetchedUrls(): string[] {
  return exa.getContents.mock.calls.flatMap(([urls]) => urls);
}

export type Extraction = {
  isSingleProductPage: boolean;
  matchesQuery: boolean;
  title: string;
  priceText: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  condition: "new" | "used" | "refurbished" | "unknown";
};

/** Pull the fields back out of the extraction prompt built by src/lib/products.ts. */
export function parseExtractionPrompt(user: string) {
  const url = /^URL: (.*)$/m.exec(user)?.[1] ?? "";
  const title = /^Page title: (.*)$/m.exec(user)?.[1] ?? "";
  const query = /^Shopper searched for: (.*)$/m.exec(user)?.[1] ?? "";
  const text = user.split("\n\nPage text:\n")[1] ?? "";
  return { url, title, query, text };
}

/**
 * What a well-behaved model returns for a product page: the first "$12.34" (or "12.34 USD") on the
 * page, quoted exactly. `overrides` (by URL) simulate pages that aren't a match, hallucinations, etc.
 */
export function fakeExtraction(user: string, overrides: Record<string, Partial<Extraction>> = {}): Extraction {
  const { url, title, text } = parseExtractionPrompt(user);
  const m = /\$([\d,]+\.\d{2})/.exec(text) ?? /([\d,]+\.\d{2}) USD/.exec(text);
  return {
    isSingleProductPage: true,
    matchesQuery: true,
    title,
    priceText: m ? m[0] : null,
    price: m ? parseFloat(m[1].replace(/,/g, "")) : null,
    currency: "USD",
    imageUrl: null,
    condition: /pre-owned|used/i.test(text) ? "used" : "new",
    ...overrides[url],
  };
}

// ---------- Incident fixtures ----------

export const ALTOIDS_URL = "https://www.amazon.com/Altoids-Arctic-Peppermint-Mints-Pack/dp/B00N9TAZHW";
export const ALTOIDS_TITLE = "ALTOIDS Arctic Peppermint Mints Breath Mints Bulk, 1.2 oz Tin (Pack of 8)";
/** Exa's stored (stale) copy of the page. */
export const ALTOIDS_STALE_TEXT = `${ALTOIDS_TITLE}
Visit the ALTOIDS Store
4.7 out of 5 stars 18,032 ratings
Price: 10.98 USD
Flavor: Arctic Peppermint
Size: 1.2 Ounce (Pack of 8)`;
/** What the live page says. */
export const ALTOIDS_LIVE_TEXT = `${ALTOIDS_TITLE}
Visit the ALTOIDS Store
4.7 out of 5 stars 18,032 ratings
$24.62 ($2.56 / Ounce)
Flavor: Arctic Peppermint
Size: 1.2 Ounce (Pack of 8)
FREE delivery Tuesday`;

/** A product page whose text carries a price; title doubles as the page title. */
export function productPage(url: string, title: string, price: string, extra = ""): FakePage {
  return { url, title, text: `${title}\n${extra ? `${extra}\n` : ""}Price: $${price}\nIn stock. Ships from and sold by the store.` };
}
