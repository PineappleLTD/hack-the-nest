import { z } from "zod";
import { db, hashKey } from "./db";
import { webSearch, type WebPage } from "./exa";
import { mapSettled, structured } from "./llm";
import { hostOf, isFirstPartySource, MARKETPLACE_IDS, SHOP_VENDORS, storeKey } from "./vendors";

export type Deal = {
  id: string;
  store: string;
  storeKey: string;
  code: string | null;
  description: string;
  discountText: string;
  expiresAt: string | null;
  sourceUrl: string;
  sourceHost: string;
  foundAt: number;
  /** What the deal covers. Only "sitewide" deals are ever auto-applied; null for deals stored before this was tracked. */
  scope: DealScope | null;
  appliesTo: string | null;
  percentOff: number | null;
  amountOff: number | null;
  minSpend: number | null;
  maxSavings: number | null;
};

export const DEAL_SCOPES = ["sitewide", "category", "product"] as const;
export type DealScope = (typeof DEAL_SCOPES)[number];

const DealsSchema = z.object({
  deals: z.array(
    z.object({
      store: z.string(),
      code: z.string().nullable(),
      description: z.string(),
      discountText: z.string(),
      expiresAt: z.string().nullable(),
      scope: z.enum(DEAL_SCOPES),
      appliesTo: z.string(),
      percentOff: z.number().nullable(),
      amountOff: z.number().nullable(),
      minSpend: z.number().nullable(),
      maxSavings: z.number().nullable(),
    }),
  ),
});

const DEALS_SYSTEM = `You extract coupon codes and deals from the text of one web page.
Rules:
- Only report deals literally stated on the page. Never invent codes, amounts, or dates.
- store: the retailer the deal is for (e.g. "Best Buy"), not the coupon site.
- code: the exact promo code as written on the page, or null if the deal needs no code / the code is hidden.
- description: one short sentence describing the deal.
- discountText: the headline discount exactly as the page phrases it (e.g. "20% off", "$10 off $50", "Free shipping").
- expiresAt: expiration date as YYYY-MM-DD if the page states one, else null.
- scope: "sitewide" ONLY if the page says it applies to the whole store, any order, or sitewide. "category" for a department, brand, collection, or "select items". "product" for one named product or one seller's listing. If unsure, use "product".
- appliesTo: what it covers in a few words, e.g. "any order", "laptops", "Dual Power Fuel Transfer Pump".
- percentOff: the percent number for a percent discount ("20% off" -> 20), else null. amountOff: the dollar amount for a dollars-off discount ("$10 off" -> 10), else null.
- minSpend: the stated minimum order in USD ("$10 off $50+" -> 50), else null. maxSavings: a stated cap on savings ("20% off, max $40" -> 40), else null.
- Skip expired deals, generic "sign up for emails" offers with no stated discount, deals for other stores, and plain product prices with no discount or code (e.g. "Blink Mini for $19.99").
- Return at most 8 deals, best first. Return an empty list if the page has none.`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rowToDeal(r: Record<string, unknown>): Deal {
  return {
    id: r.id as string,
    store: r.store as string,
    storeKey: r.store_key as string,
    code: (r.code as string) ?? null,
    description: r.description as string,
    discountText: r.discount_text as string,
    expiresAt: (r.expires_at as string) ?? null,
    sourceUrl: r.source_url as string,
    sourceHost: hostOf(r.source_url as string),
    foundAt: r.found_at as number,
    scope: (r.scope as DealScope) ?? null,
    appliesTo: (r.applies_to as string) ?? null,
    percentOff: (r.percent_off as number) ?? null,
    amountOff: (r.amount_off as number) ?? null,
    minSpend: (r.min_spend as number) ?? null,
    maxSavings: (r.max_savings as number) ?? null,
  };
}

const ACTIVE = `(expires_at IS NULL OR expires_at >= ?)`;
const SCOPE_ORDER = `CASE scope WHEN 'sitewide' THEN 0 WHEN 'category' THEN 1 ELSE 2 END`;

/** Deals change daily; re-search the web after this long instead of serving cached pages forever. */
const DEAL_SEARCH_MAX_AGE = 12 * 3600 * 1000;

export function dealsForStore(key: string): Deal[] {
  return (
    db
      .prepare(`SELECT * FROM deals WHERE store_key = ? AND ${ACTIVE} ORDER BY ${SCOPE_ORDER}, (code IS NULL), found_at DESC`)
      .all(key, today()) as Record<string, unknown>[]
  ).map(rowToDeal);
}

/**
 * Deals worth showing next to a store's results: store-wide (sitewide or category, not tied to one
 * product) and verifiable. That means published on the store's own site, or, for codes at stores
 * that aren't marketplaces, the same code listed by at least two independent sites. A code on one
 * coupon site alone is usually SEO filler that never worked. One row per code.
 */
export function storeWideDeals(key: string): Deal[] {
  const all = dealsForStore(key);
  const hostsByCode = new Map<string, Set<string>>();
  for (const d of all) {
    if (!d.code) continue;
    const c = d.code.toUpperCase();
    if (!hostsByCode.has(c)) hostsByCode.set(c, new Set());
    hostsByCode.get(c)!.add(d.sourceHost);
  }
  const seenCodes = new Set<string>();
  return all.filter((d) => {
    if (d.scope !== "sitewide" && d.scope !== "category") return false;
    const firstParty = isFirstPartySource(key, d.sourceHost);
    const corroborated = !!d.code && !MARKETPLACE_IDS.has(key) && (hostsByCode.get(d.code.toUpperCase())?.size ?? 0) >= 2;
    if (!firstParty && !corroborated) return false;
    if (d.code) {
      const c = d.code.toUpperCase();
      if (seenCodes.has(c)) return false;
      seenCodes.add(c);
    }
    return true;
  });
}

/** Verifiable store-wide deal counts for each shop vendor id, for search-result badges. */
export function dealCountsByVendor(): Record<string, number> {
  return Object.fromEntries(
    SHOP_VENDORS.map((v) => [v.id, storeWideDeals(v.id).length] as const).filter(([, n]) => n > 0),
  );
}

function grounded(text: string, d: z.infer<typeof DealsSchema>["deals"][number]): boolean {
  const hay = text.toLowerCase().replace(/\s+/g, " ");
  if (d.code) return hay.includes(d.code.toLowerCase());
  return hay.includes(d.discountText.toLowerCase().replace(/\s+/g, " "));
}

/** Throws on LLM/API errors; returns [] when the page has no grounded deals. */
/** Keep a number only if it is literally in the text (e.g. 20 -> "20%", 10 -> "$10"). */
function groundedNumber(n: number | null, text: string, kind: "percent" | "dollars"): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const t = text.replace(/,/g, "").replace(/\s+/g, "");
  const forms = [String(n), n.toFixed(2)];
  const ok = forms.some((f) => (kind === "percent" ? t.includes(`${f}%`) : t.includes(`$${f}`)));
  return ok ? n : null;
}

async function extractDeals(page: WebPage, query: string) {
  const data = await structured(
    "deal_extraction",
    DealsSchema,
    DEALS_SYSTEM,
    `Looking for deals on: ${query}\nToday: ${today()}\nURL: ${page.url}\nPage title: ${page.title}\n\nPage text:\n${page.text}`,
  );
  if (!data) return [];
  return data.deals
    .filter((d) => d.store.trim() && d.discountText.trim() && grounded(page.text, d))
    .map((d) => ({
      ...d,
      appliesTo: d.appliesTo.trim() || null,
      percentOff: groundedNumber(d.percentOff, `${d.discountText} ${d.description}`, "percent"),
      amountOff: groundedNumber(d.amountOff, `${d.discountText} ${d.description}`, "dollars"),
      // Fine print can sit anywhere on the page, so check minimums and caps against the page text.
      minSpend: groundedNumber(d.minSpend, page.text, "dollars"),
      maxSavings: groundedNumber(d.maxSavings, page.text, "dollars"),
      code: d.code?.trim() || null,
      expiresAt: d.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(d.expiresAt) ? d.expiresAt : null,
      sourceUrl: page.url,
      sourceTitle: page.title,
    }));
}

// Re-finding a deal refreshes its details and "found" time.
const insert = db.prepare(`INSERT INTO deals
  (id, store, store_key, query, code, description, discount_text, expires_at, source_url, source_title, found_at,
   scope, applies_to, percent_off, amount_off, min_spend, max_savings)
  VALUES (@id, @store, @store_key, @query, @code, @description, @discount_text, @expires_at, @source_url, @source_title, @found_at,
   @scope, @applies_to, @percent_off, @amount_off, @min_spend, @max_savings)
  ON CONFLICT(id) DO UPDATE SET store = excluded.store, store_key = excluded.store_key, description = excluded.description,
   expires_at = excluded.expires_at, source_title = excluded.source_title, found_at = excluded.found_at, scope = excluded.scope,
   applies_to = excluded.applies_to, percent_off = excluded.percent_off, amount_off = excluded.amount_off,
   min_spend = excluded.min_spend, max_savings = excluded.max_savings`);

/** Search the web for deals, store any grounded ones, return active deals for this query/store. */
export async function findDeals(query: string): Promise<Deal[]> {
  // Day precision so the Exa cache key is stable within a day (a millisecond timestamp never hits the cache).
  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const settled = await Promise.allSettled([
    webSearch(`${query} promo codes coupons this month`, { numResults: 8, maxCharacters: 8000, startPublishedDate: since, maxAgeMs: DEAL_SEARCH_MAX_AGE }),
    webSearch(`${query} current sale deals discounts`, { numResults: 6, maxCharacters: 8000, maxAgeMs: DEAL_SEARCH_MAX_AGE }),
  ]);
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
  failures.forEach((f) => console.error("[deals]", f.reason instanceof Error ? f.reason.message : f.reason));
  if (failures.length === settled.length) throw failures[0].reason;
  const found = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const pages = [...new Map(found.map((p) => [p.url, p])).values()];
  const extracted = (await mapSettled(pages, 8, (p) => extractDeals(p, query))).flatMap((d) => d ?? []);

  const now = Date.now();
  const ids: string[] = [];
  db.transaction(() => {
    for (const d of extracted) {
      const id = hashKey([d.sourceUrl, d.code, d.discountText.toLowerCase()]);
      ids.push(id);
      insert.run({
        id,
        store: d.store.trim(),
        store_key: storeKey(d.store),
        query,
        code: d.code,
        description: d.description,
        discount_text: d.discountText,
        expires_at: d.expiresAt,
        source_url: d.sourceUrl,
        source_title: d.sourceTitle,
        found_at: now,
        scope: d.scope,
        applies_to: d.appliesTo,
        percent_off: d.percentOff,
        amount_off: d.amountOff,
        min_spend: d.minSpend,
        max_savings: d.maxSavings,
      });
    }
  })();

  // Return this run's deals plus anything stored earlier for the same store.
  const key = storeKey(query);
  const rows = db
    .prepare(
      `SELECT * FROM deals WHERE (store_key = ? OR id IN (SELECT value FROM json_each(?))) AND ${ACTIVE}
       ORDER BY ${SCOPE_ORDER}, (code IS NULL), found_at DESC`,
    )
    .all(key, JSON.stringify(ids), today()) as Record<string, unknown>[];
  return rows.map(rowToDeal);
}
