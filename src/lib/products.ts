import { z } from "zod";
import { webSearch, type WebPage } from "./exa";
import { mapLimit, tryStructured } from "./llm";
import { SHOP_VENDORS, vendorForUrl, type Vendor } from "./vendors";

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

/** Guard against hallucination: the quoted price must appear on the page and agree with the number. */
export function priceIsGrounded(text: string, priceText: string | null, price: number | null): price is number {
  if (!priceText || price == null || !Number.isFinite(price) || price <= 0) return false;
  if (!normalizeSpaces(text).includes(normalizeSpaces(priceText.trim()))) return false;
  const digits = priceText.replace(/[^0-9.]/g, "");
  const n = parseFloat(digits);
  return Number.isFinite(n) && Math.abs(n - price) < 0.01;
}

export async function extractProduct(page: WebPage, query: string, vendor: Vendor): Promise<Product | null> {
  const data = await tryStructured(
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

/** Search all trusted vendors, extract grounded prices, sort cheapest first. */
export async function searchProducts(query: string): Promise<Product[]> {
  // One Exa call per vendor keeps results diverse (a single combined call tends to be all-Amazon).
  const perVendor = await Promise.all(
    SHOP_VENDORS.map((v) =>
      webSearch(query, { includeDomains: [v.domain], numResults: 5, maxCharacters: 6000 }).catch((e) => {
        console.error(`[search:${v.id}]`, e instanceof Error ? e.message : e);
        return [] as WebPage[];
      }),
    ),
  );

  const pages: { page: WebPage; vendor: Vendor }[] = [];
  const seen = new Set<string>();
  for (const page of perVendor.flat()) {
    const vendor = vendorForUrl(page.url);
    if (!vendor || seen.has(page.url)) continue;
    seen.add(page.url);
    pages.push({ page, vendor });
  }

  const products = await mapLimit(pages, 10, ({ page, vendor }) => extractProduct(page, query, vendor));
  return products.filter((p): p is Product => p !== null).sort((a, b) => a.price - b.price);
}

// ---------- Plain-English filters ----------

export const FilterSpecSchema = z.object({
  maxPrice: z.number().nullable(),
  minPrice: z.number().nullable(),
  vendors: z.array(z.enum(SHOP_VENDORS.map((v) => v.id) as [string, ...string[]])),
  conditions: z.array(z.enum(CONDITIONS)),
  mustInclude: z.array(z.string()),
  mustExclude: z.array(z.string()),
});
export type FilterSpec = z.infer<typeof FilterSpecSchema>;

export const FILTER_SYSTEM = `Convert a shopper's plain-English refinement into a filter spec.
- maxPrice / minPrice: numbers in USD, or null if not mentioned. "under $200" -> maxPrice 200.
- vendors: vendor ids to KEEP, chosen from: ${SHOP_VENDORS.map((v) => `${v.id} (${v.name})`).join(", ")}. Empty array = all vendors.
- conditions: conditions to KEEP from new, used, refurbished, unknown. Empty = all. "new only" -> ["new"].
- mustInclude: words/phrases that must appear in the product title (e.g. a color, size, model). Empty if none.
- mustExclude: words/phrases that must NOT appear in the title. Empty if none.
Only include constraints the shopper actually stated.`;

export function applyFilter(products: Product[], spec: FilterSpec): Product[] {
  const inc = spec.mustInclude.map((s) => s.toLowerCase());
  const exc = spec.mustExclude.map((s) => s.toLowerCase());
  return products.filter((p) => {
    if (spec.maxPrice != null && p.price > spec.maxPrice) return false;
    if (spec.minPrice != null && p.price < spec.minPrice) return false;
    if (spec.vendors.length && !spec.vendors.includes(p.vendor)) return false;
    if (spec.conditions.length && !spec.conditions.includes(p.condition)) return false;
    const t = p.title.toLowerCase();
    if (inc.some((w) => !t.includes(w))) return false;
    if (exc.some((w) => t.includes(w))) return false;
    return true;
  });
}
