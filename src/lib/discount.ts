import type { Deal } from "./deals";
import { isFirstPartySource, MARKETPLACE_IDS } from "./vendors";

export type AppliedDeal = { deal: Deal; price: number; saved: number };

// Fine print that means a code may not cover this product, so we never apply it automatically.
const RESTRICTED =
  /\b(up to|select(ed)?|first|new (customer|member|user)s?|app|members?|students?|clearance|eligible|exclusions?|in[- ]store|subscribe|sign[- ]up)\b/i;

// No real store-wide code takes more than half off; a bigger claim is coupon-site noise.
const MAX_SHARE_OFF = 0.5;

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What a product costs with this deal, only when the deal is unambiguous: a code the store's own
 * website published (coupon sites list plenty of codes that never worked), marked sitewide, at a
 * store that isn't a marketplace, with a percent or dollar amount we could find in the deal text,
 * any stated minimum met, no limiting fine print, and a saving no bigger than half the price.
 * Otherwise null.
 */
export function applyDeal(price: number, deal: Deal): AppliedDeal | null {
  if (!deal.code || deal.scope !== "sitewide") return null;
  // Marketplace codes belong to one seller/listing, even when a coupon site calls them "sitewide".
  if (MARKETPLACE_IDS.has(deal.storeKey)) return null;
  if (!isFirstPartySource(deal.storeKey, deal.sourceHost)) return null;
  if (RESTRICTED.test(deal.discountText) || RESTRICTED.test(deal.description)) return null;
  if (!(price > 0)) return null;
  if (deal.minSpend != null && price < deal.minSpend) return null;

  let saved = 0;
  if (deal.percentOff != null) saved = price * (deal.percentOff / 100);
  else if (deal.amountOff != null) saved = deal.amountOff;
  if (deal.maxSavings != null) saved = Math.min(saved, deal.maxSavings);
  saved = cents(saved);
  if (saved <= 0 || saved > price * MAX_SHARE_OFF) return null;

  return { deal, price: cents(price - saved), saved };
}

/** The biggest saving among a store's deals for this price, if any deal applies cleanly. */
export function bestDeal(price: number, deals: Deal[]): AppliedDeal | null {
  let best: AppliedDeal | null = null;
  for (const d of deals) {
    const a = applyDeal(price, d);
    if (a && (!best || a.saved > best.saved)) best = a;
  }
  return best;
}
