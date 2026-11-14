/**
 * Minimal eBay Sell Inventory API flow: inventory item -> offer -> publish.
 * Requires a user OAuth token (EBAY_OAUTH_TOKEN) with sell.inventory + sell.account scopes,
 * and a seller account that already has business policies and an inventory location.
 */
const BASE = process.env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const MARKETPLACE = "EBAY_US";

export type EbayListingInput = {
  title: string;
  description: string;
  price: number;
  condition: string;
  imageUrls: string[];
};

async function ebay<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = process.env.EBAY_OAUTH_TOKEN;
  if (!token) throw new Error("EBAY_OAUTH_TOKEN is not set");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = json?.errors?.[0]?.longMessage ?? json?.errors?.[0]?.message ?? `eBay ${res.status}`;
    throw new Error(`eBay: ${msg}`);
  }
  return json as T;
}

function conditionEnum(c: string): string {
  const s = c.toLowerCase();
  if (s.includes("new") && !s.includes("like")) return "NEW";
  if (s.includes("like new") || s.includes("excellent")) return "LIKE_NEW";
  if (s.includes("refurb")) return "SELLER_REFURBISHED";
  if (s.includes("fair") || s.includes("acceptable")) return "USED_ACCEPTABLE";
  if (s.includes("parts") || s.includes("broken")) return "FOR_PARTS_OR_NOT_WORKING";
  if (s.includes("very good")) return "USED_VERY_GOOD";
  return "USED_GOOD";
}

async function firstPolicyId(kind: "fulfillment" | "payment" | "return"): Promise<string> {
  const key = `${kind}Policies`;
  const json = await ebay<Record<string, { [k: string]: string }[]>>(
    "GET",
    `/sell/account/v1/${kind}_policy?marketplace_id=${MARKETPLACE}`,
  );
  const id = json[key]?.[0]?.[`${kind}PolicyId`];
  if (!id) throw new Error(`eBay: no ${kind} policy on this seller account`);
  return id;
}

export async function createEbayListing(input: EbayListingInput): Promise<{ listingId: string; url: string }> {
  if (!input.imageUrls.length) throw new Error("eBay requires at least one public photo URL to publish a listing");

  const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId, locations, suggestions] = await Promise.all([
    firstPolicyId("fulfillment"),
    firstPolicyId("payment"),
    firstPolicyId("return"),
    ebay<{ locations?: { merchantLocationKey: string }[] }>("GET", "/sell/inventory/v1/location"),
    ebay<{ categorySuggestions?: { category: { categoryId: string } }[] }>(
      "GET",
      `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(input.title)}`,
    ),
  ]);
  const merchantLocationKey = locations.locations?.[0]?.merchantLocationKey;
  if (!merchantLocationKey) throw new Error("eBay: add an inventory location to your seller account first");
  const categoryId = suggestions.categorySuggestions?.[0]?.category.categoryId;
  if (!categoryId) throw new Error("eBay: couldn't find a category for this item");

  const sku = `agentshop-${Date.now()}`;
  await ebay("PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: conditionEnum(input.condition),
    product: { title: input.title.slice(0, 80), description: input.description, imageUrls: input.imageUrls },
  });
  const offer = await ebay<{ offerId: string }>("POST", "/sell/inventory/v1/offer", {
    sku,
    marketplaceId: MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId,
    listingDescription: input.description,
    listingPolicies: { fulfillmentPolicyId, paymentPolicyId, returnPolicyId },
    merchantLocationKey,
    pricingSummary: { price: { value: input.price.toFixed(2), currency: "USD" } },
  });
  const published = await ebay<{ listingId: string }>("POST", `/sell/inventory/v1/offer/${offer.offerId}/publish`);
  const host = process.env.EBAY_ENV === "sandbox" ? "https://sandbox.ebay.com" : "https://www.ebay.com";
  return { listingId: published.listingId, url: `${host}/itm/${published.listingId}` };
}
