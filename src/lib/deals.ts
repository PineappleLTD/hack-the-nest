import { z } from "zod";
import { db, hashKey } from "./db";
import { webSearch, type WebPage } from "./exa";
import { mapSettled, structured } from "./llm";
import { hostOf, SHOP_VENDORS, storeKey } from "./vendors";

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
};

const DealsSchema = z.object({
  deals: z.array(
    z.object({
      store: z.string(),
      code: z.string().nullable(),
      description: z.string(),
      discountText: z.string(),
      expiresAt: z.string().nullable(),
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
- Skip expired deals, generic "sign up for emails" offers with no stated discount, and deals for other stores.
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
  };
}

const ACTIVE = `(expires_at IS NULL OR expires_at >= ?)`;

/** Deals change daily; re-search the web after this long instead of serving cached pages forever. */
const DEAL_SEARCH_MAX_AGE = 12 * 3600 * 1000;

export function dealsForStore(key: string): Deal[] {
  return (
    db
      .prepare(`SELECT * FROM deals WHERE store_key = ? AND ${ACTIVE} ORDER BY (code IS NULL), found_at DESC`)
      .all(key, today()) as Record<string, unknown>[]
  ).map(rowToDeal);
}

/** Active deal counts for each shop vendor id, for search-result badges. */
export function dealCountsByVendor(): Record<string, number> {
  const rows = db
    .prepare(`SELECT store_key, COUNT(*) AS n FROM deals WHERE ${ACTIVE} GROUP BY store_key`)
    .all(today()) as { store_key: string; n: number }[];
  const ids = new Set(SHOP_VENDORS.map((v) => v.id));
  return Object.fromEntries(rows.filter((r) => ids.has(r.store_key)).map((r) => [r.store_key, r.n]));
}

function grounded(text: string, d: z.infer<typeof DealsSchema>["deals"][number]): boolean {
  const hay = text.toLowerCase().replace(/\s+/g, " ");
  if (d.code) return hay.includes(d.code.toLowerCase());
  return hay.includes(d.discountText.toLowerCase().replace(/\s+/g, " "));
}

/** Throws on LLM/API errors; returns [] when the page has no grounded deals. */
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
      code: d.code?.trim() || null,
      expiresAt: d.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(d.expiresAt) ? d.expiresAt : null,
      sourceUrl: page.url,
      sourceTitle: page.title,
    }));
}

const insert = db.prepare(`INSERT OR IGNORE INTO deals
  (id, store, store_key, query, code, description, discount_text, expires_at, source_url, source_title, found_at)
  VALUES (@id, @store, @store_key, @query, @code, @description, @discount_text, @expires_at, @source_url, @source_title, @found_at)`);

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
      });
    }
  })();

  // Return this run's deals plus anything stored earlier for the same store.
  const key = storeKey(query);
  const rows = db
    .prepare(
      `SELECT * FROM deals WHERE (store_key = ? OR id IN (SELECT value FROM json_each(?))) AND ${ACTIVE}
       ORDER BY (code IS NULL), found_at DESC`,
    )
    .all(key, JSON.stringify(ids), today()) as Record<string, unknown>[];
  return rows.map(rowToDeal);
}
