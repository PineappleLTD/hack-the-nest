import type { Deal } from "./deals";

export type AppliedDeal = { deal: Deal; price: number; saved: number };

// Fine print that means a code may not cover this product, so we never apply it automatically.
const RESTRICTED =
  /\b(up to|select(ed)?|first|new (customer|member|user)s?|app|members?|students?|clearance|eligible|exclusions?|in[- ]store|subscribe|sign[- ]up)\b/i;

const money = (s: string) => Number(s.replace(/,/g, ""));

/**
 * What a product costs with this deal, when the deal is unambiguous: a code, a flat percent or dollar
 * amount off, any stated minimum met, and no fine print limiting which items it covers. Otherwise null.
 */
export function applyDeal(price: number, deal: Deal): AppliedDeal | null {
  if (!deal.code) return null;
  const text = deal.discountText;
  if (RESTRICTED.test(text) || RESTRICTED.test(deal.description)) return null;

  const min = text.match(/(?:orders?\s+(?:of|over)\s+|spend\s+|off\s+)\$(\d[\d,]*(?:\.\d+)?)|\$(\d[\d,]*(?:\.\d+)?)\s*\+/i);
  const minSpend = min ? money(min[1] ?? min[2]) : 0;
  if (price < minSpend) return null;

  let saved = 0;
  const pct = text.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*off/i);
  const amt = text.match(/\$(\d[\d,]*(?:\.\d+)?)\s*off/i);
  if (pct) saved = price * (Number(pct[1]) / 100);
  else if (amt) saved = money(amt[1]);
  saved = Math.round(Math.min(saved, price) * 100) / 100;
  if (saved <= 0) return null;

  return { deal, price: Math.round((price - saved) * 100) / 100, saved };
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
