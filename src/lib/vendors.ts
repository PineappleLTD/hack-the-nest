export type Vendor = {
  id: string;
  name: string;
  domain: string;
  /** Tailwind classes for the vendor badge. */
  badge: string;
  /** URL path of a single product/listing page (not search, category or brand pages). */
  productPath: RegExp;
};

export const SHOP_VENDORS: Vendor[] = [
  { id: "amazon", name: "Amazon", domain: "amazon.com", badge: "bg-amber-50 text-amber-800 ring-amber-200", productPath: /\/(dp|gp\/product)\/[A-Z0-9]{10}/i },
  { id: "ebay", name: "eBay", domain: "ebay.com", badge: "bg-sky-50 text-sky-800 ring-sky-200", productPath: /^\/(itm|p)\/(.+\/)?\d+/ },
  { id: "etsy", name: "Etsy", domain: "etsy.com", badge: "bg-orange-50 text-orange-800 ring-orange-200", productPath: /\/listing\/\d+/ },
  { id: "bestbuy", name: "Best Buy", domain: "bestbuy.com", badge: "bg-blue-50 text-blue-800 ring-blue-200", productPath: /^\/(site\/.+\/\d+\.p|product\/)/ },
  { id: "walmart", name: "Walmart", domain: "walmart.com", badge: "bg-indigo-50 text-indigo-800 ring-indigo-200", productPath: /^\/ip\// },
  { id: "target", name: "Target", domain: "target.com", badge: "bg-red-50 text-red-800 ring-red-200", productPath: /^\/p\/.*A-\d+/ },
];

export const RESALE_MARKETS: Vendor[] = [
  { id: "ebay", name: "eBay", domain: "ebay.com", badge: "bg-sky-50 text-sky-800 ring-sky-200", productPath: /^\/(itm|p)\/(.+\/)?\d+/ },
  { id: "mercari", name: "Mercari", domain: "mercari.com", badge: "bg-violet-50 text-violet-800 ring-violet-200", productPath: /\/item\/m\d+/ },
  { id: "facebook", name: "Facebook Marketplace", domain: "facebook.com", badge: "bg-blue-50 text-blue-800 ring-blue-200", productPath: /^\/marketplace\/item\/\d+/ },
];

const ALL = [...SHOP_VENDORS, ...RESALE_MARKETS];

/**
 * Marketplaces where a promo code belongs to one seller or listing, so a code found online can't be
 * assumed to cover a given item.
 */
export const MARKETPLACE_IDS = new Set(["amazon", "ebay", "etsy"]);

/** True if a deal's source page is on the store's own site (e.g. target.com for Target). */
export function isFirstPartySource(storeId: string, sourceHost: string): boolean {
  const domain = vendorById(storeId)?.domain;
  return !!domain && (sourceHost === domain || sourceHost.endsWith(`.${domain}`));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Map a URL to a known vendor by its domain (never trust the LLM for this). */
export function vendorForUrl(url: string): Vendor | undefined {
  const host = hostOf(url);
  return ALL.find((v) => host === v.domain || host.endsWith("." + v.domain));
}

/** True if the URL is a single product/listing page on one of our vendors. */
export function isProductPage(url: string, vendor: Vendor): boolean {
  try {
    return vendor.productPath.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function vendorById(id: string): Vendor | undefined {
  return ALL.find((v) => v.id === id);
}

/** Normalize a store name/domain into a lookup key, e.g. "Best Buy" / "bestbuy.com" -> "bestbuy". */
export function storeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|net|org|co|us|ca)(\/.*)?$/, "")
    .replace(/[^a-z0-9]/g, "");
}
