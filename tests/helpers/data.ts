/** Builders for products and stored deals. */
import type { Product } from "@/lib/products";
import type { Deal } from "@/lib/deals";

let n = 0;

export function product(p: Partial<Product> & Pick<Product, "title" | "price">): Product {
  const vendor = p.vendor ?? "ebay";
  const url = p.url ?? `https://www.${vendor}.com/itm/${100000 + ++n}`;
  return {
    id: url,
    currency: "USD",
    vendor,
    vendorName: p.vendorName ?? vendor,
    url,
    imageUrl: null,
    condition: "new",
    ...p,
  };
}

/** A Deal as the client receives it (for applyDeal / bestDeal). */
export function deal(d: Partial<Deal> & Pick<Deal, "storeKey" | "sourceHost">): Deal {
  return {
    id: `deal-${++n}`,
    store: d.storeKey,
    code: "SAVE",
    description: "Deal",
    discountText: "Deal",
    expiresAt: null,
    sourceUrl: `https://${d.sourceHost}/deal`,
    foundAt: Date.now(),
    scope: "sitewide",
    appliesTo: "any order",
    percentOff: null,
    amountOff: null,
    minSpend: null,
    maxSavings: null,
    ...d,
  };
}

export type DealRow = {
  id?: string;
  store: string;
  store_key: string;
  query?: string;
  code: string | null;
  description?: string;
  discount_text: string;
  expires_at?: string | null;
  source_url: string;
  source_title?: string | null;
  found_at?: number;
  scope: string | null;
  applies_to?: string | null;
  percent_off?: number | null;
  amount_off?: number | null;
  min_spend?: number | null;
  max_savings?: number | null;
};

type Db = { prepare: (sql: string) => { run: (params: Record<string, unknown>) => unknown } };

/** Insert a row into the deals table the way findDeals stores them. */
export function insertDeal(db: Db, row: DealRow) {
  const full = {
    id: `row-${++n}`,
    query: row.store,
    description: row.discount_text,
    expires_at: null,
    source_title: null,
    found_at: Date.now(),
    applies_to: null,
    percent_off: null,
    amount_off: null,
    min_spend: null,
    max_savings: null,
    ...row,
  };
  db.prepare(
    `INSERT INTO deals (id, store, store_key, query, code, description, discount_text, expires_at, source_url, source_title,
      found_at, scope, applies_to, percent_off, amount_off, min_spend, max_savings)
     VALUES (@id, @store, @store_key, @query, @code, @description, @discount_text, @expires_at, @source_url, @source_title,
      @found_at, @scope, @applies_to, @percent_off, @amount_off, @min_spend, @max_savings)`,
  ).run(full);
  return full.id;
}
