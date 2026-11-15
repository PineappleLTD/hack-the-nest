import { z } from "zod";
import { freshPages, searchUrls, type WebPage } from "./exa";
import { mapSettled, structured } from "./llm";
import { SHOP_VENDORS, uniqueProductUrls, type Vendor } from "./vendors";

export const CONDITIONS = ["new", "used", "refurbished", "unknown"] as const;
export type Condition = (typeof CONDITIONS)[number];

export type Product = {
  id: string;
  title: string;
  price: number;
  currency: string;
  vendor: string; // vendor id
  vendorName: string;
  url: string;
  imageUrl: string | null;
  condition: Condition;
};

const ExtractionSchema = z.object({
  isSingleProductPage: z.boolean(),
  matchesQuery: z.boolean(),
  title: z.string(),
  priceText: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string(),
  imageUrl: z.string().nullable(),
  condition: z.enum(CONDITIONS),
});

const EXTRACT_SYSTEM = `You extract product listing data from the text of a single web page.
Rules:
- Only report what is literally on the page. Never guess or estimate a price.
- isSingleProductPage: true only if the page is for one specific product/listing (not a search, category, review, or list page).
- matchesQuery: true if the product is the item the shopper searched for (or a direct variant of it). False for accessories, cases, parts, or unrelated items.
- priceText: the exact current selling price string as it appears on the page (e.g. "$189.99"). Use the buy-box / current price, not a list/was price, shipping cost, monthly payment, or a price for a different product. null if none is clearly stated.
- price: the numeric value of priceText (e.g. 189.99), or null.
- currency: ISO code, e.g. "USD".
- title: the product's name, cleaned up and concise (max ~90 chars).
- imageUrl: a full https product image URL only if one literally appears in the text; otherwise null.
- condition: new / used / refurbished (incl. renewed, open-box) / unknown.`;

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ");
}

/**
 * True if `quote` appears in `text` as a whole amount, not as part of a longer number:
 * "$14" is not in "$149.99", "$1" is not in "$1,299", "49.99" is not in "149.99".
 */
export function containsAmount(text: string, quote: string): boolean {
  if (!quote) return false;
  const startsWithDigit = /^\d/.test(quote);
  const endsWithDigit = /\d$/.test(quote);
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const before = text[i - 1] ?? "";
    const after = text.slice(i + quote.length, i + quote.length + 2);
    if (startsWithDigit && /[\d.,]/.test(before)) continue;
    if (endsWithDigit && /^(\d|[.,]\d)/.test(after)) continue;
    return true;
  }
  return false;
}

/** Guard against hallucination: the quoted price must appear on the page and agree with the number. */
export function priceIsGrounded(text: string, priceText: string | null, price: number | null): price is number {
  if (!priceText || price == null || !Number.isFinite(price) || price <= 0) return false;
  if (!containsAmount(normalizeSpaces(text), normalizeSpaces(priceText.trim()))) return false;
  const digits = priceText.replace(/[^0-9.]/g, "");
  const n = parseFloat(digits);
  return Number.isFinite(n) && Math.abs(n - price) < 0.01;
}

/** Throws on LLM/API errors; returns null when the page isn't a grounded, priced match. */
export async function extractProduct(page: WebPage, query: string, vendor: Vendor): Promise<Product | null> {
  const data = await structured(
    "product_extraction",
    ExtractionSchema,
    EXTRACT_SYSTEM,
    `Shopper searched for: ${query}\nURL: ${page.url}\nPage title: ${page.title}\n\nPage text:\n${page.text}`,
  );
  if (!data) return null;
  if (!data.isSingleProductPage || !data.matchesQuery) return null;
  if (!priceIsGrounded(page.text, data.priceText, data.price)) return null;
  if (data.currency.toUpperCase() !== "USD") return null;

  const imageUrl =
    page.image ?? (data.imageUrl && /^https:\/\//.test(data.imageUrl) && page.text.includes(data.imageUrl) ? data.imageUrl : null);

  return {
    id: page.url,
    title: data.title || page.title,
    price: data.price as number,
    currency: "USD",
    vendor: vendor.id,
    vendorName: vendor.name,
    url: page.url, // always the real page we read, never model output
    imageUrl,
    condition: data.condition,
  };
}

/** Exa returns up to this many URLs per store (same price for 1-25); only product pages are read. */
const URLS_PER_VENDOR = 15;
const PAGES_PER_VENDOR = 6;

/**
 * Search all trusted vendors, extract grounded prices, sort cheapest first.
 * Per vendor: a cheap URL-only search, keep single product pages (search and category pages
 * never have one price), read those pages fresh (prices are never older than an hour), extract.
 * Each vendor's pages are extracted as soon as its own search returns.
 */
export async function searchProducts(query: string): Promise<Product[]> {
  const settled = await Promise.allSettled(
    SHOP_VENDORS.map(async (v) => {
      const hits = await searchUrls(query, { includeDomains: [v.domain], numResults: URLS_PER_VENDOR });
      const urls = uniqueProductUrls(
        hits.map((h) => h.url),
        v,
      ).slice(0, PAGES_PER_VENDOR);
      const pages = urls.length ? await freshPages(urls) : [];
      // A page whose extraction fails is skipped; if all of this vendor's pages fail, the vendor fails.
      const products = await mapSettled(pages, pages.length, (page) => extractProduct(page, query, v));
      return { products: products.filter((p): p is Product => p !== null), pages: pages.length };
    }),
  );
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
  failures.forEach((f) => console.error("[search]", f.reason instanceof Error ? f.reason.message : f.reason));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const products = ok.flatMap((r) => r.products);
  // Nothing found and no vendor got as far as reading pages: that's an outage or a bad key, not "no results".
  if (!products.length && failures.length && !ok.some((r) => r.pages > 0)) throw failures[0].reason;
  return dropRepeats(dropImplausible(products)).sort((a, b) => a.price - b.price);
}

/**
 * The same store often lists one product under several ids (variants of one parent on Amazon), which
 * would show as identical rows. Keep the first of each store + title + price.
 */
export function dropRepeats(products: Product[]): Product[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const key = `${p.vendor}|${normalizeSpaces(p.title).trim().toLowerCase()}|${p.price.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const STOP_WORDS = new Set(["the", "and", "with", "for", "of", "in", "on", "to", "by", "new", "used", "renewed", "restored", "refurbished"]);

export function titleTokens(title: string): Set<string> {
  const plain = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return new Set((plain.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Cheapest-first puts any junk price at the very top: an accessory listed under the product's
 * name, a stale crawl, a scam. A result is dropped only when at least three near-identical
 * listings (by title) cost far more: under 40% of their median, the bar the Sell price check uses
 * for comps. Broad searches ("pokemon") keep cheap items, because those have no close twins.
 */
export function dropImplausible(products: Product[]): Product[] {
  const tokens = products.map((p) => titleTokens(p.title));
  return products.filter((p, i) => {
    const peers = products.filter((_, j) => j !== i && jaccard(tokens[i], tokens[j]) >= 0.4).map((q) => q.price);
    if (peers.length < 3) return true;
    const med = median(peers);
    const ok = p.price >= med * 0.4;
    if (!ok) console.log(`[search] dropped implausible $${p.price} (similar listings' median $${med}): ${p.url}`);
    return ok;
  });
}

// ---------- Plain-English filters ----------

export const FilterSpecSchema = z.object({
  maxPrice: z.number().nullable(),
  minPrice: z.number().nullable(),
  vendors: z.array(z.enum(SHOP_VENDORS.map((v) => v.id) as [string, ...string[]])),
  conditions: z.array(z.enum(CONDITIONS)),
  exclude: z.array(z.number()),
});
export type FilterSpec = z.infer<typeof FilterSpecSchema>;

export const FILTER_SYSTEM = `You apply a shopper's plain-English refinement to a numbered list of search results.
Return:
- maxPrice / minPrice: USD bounds the shopper stated, or null. "under $200" -> maxPrice 200.
- vendors: store ids to KEEP, chosen from: ${SHOP_VENDORS.map((v) => `${v.id} (${v.name})`).join(", ")}. Empty array = all stores.
- conditions: conditions to KEEP from new, used, refurbished, unknown. Empty = all. "new only" -> ["new"].
- exclude: the numbers of results that fail any OTHER part of the request (model, size, capacity, color, bundle or not, brand, edition, etc.), judged from the title. Don't repeat price/store/condition here; those fields cover them. Empty if the request has no other criteria.
Only apply constraints the shopper actually stated. If a title doesn't say whether it matches a criterion, keep it.`;

const MAX_FILTER_PRODUCTS = 120;

function filterPrompt(text: string, products: Product[]): string {
  const lines = products.map((p, i) => `${i}. ${p.title} | $${p.price.toFixed(2)} | ${p.vendorName} | ${p.condition}`);
  return `Refinement: ${text}\n\nResults:\n${lines.join("\n")}`;
}

export function applyFilter(products: Product[], spec: FilterSpec): Product[] {
  const exclude = new Set(spec.exclude);
  return products.filter((p, i) => {
    if (exclude.has(i)) return false;
    if (spec.maxPrice != null && p.price > spec.maxPrice) return false;
    if (spec.minPrice != null && p.price < spec.minPrice) return false;
    if (spec.vendors.length && !spec.vendors.includes(p.vendor)) return false;
    if (spec.conditions.length && !spec.conditions.includes(p.condition)) return false;
    return true;
  });
}

/**
 * The only agent step in Shop, and it runs only when the shopper asks for a filter.
 * Hard constraints (price, store, condition) are applied in code; Claude flags the
 * results that fail anything else. Order (cheapest first) is preserved.
 */
export async function filterProducts(text: string, products: Product[]): Promise<{ spec: FilterSpec; products: Product[] } | null> {
  const list = products.slice(0, MAX_FILTER_PRODUCTS);
  const spec = await structured("filter_spec", FilterSpecSchema, FILTER_SYSTEM, filterPrompt(text, list));
  if (!spec) return null;
  return { spec, products: applyFilter(list, spec) };
}
