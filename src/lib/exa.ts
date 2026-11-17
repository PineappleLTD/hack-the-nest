import Exa from "exa-js";
import { cached, db, hashKey } from "./db";

export type WebPage = {
  url: string;
  title: string;
  text: string;
  image: string | null;
  publishedDate: string | null;
};

let client: Exa | null = null;
function exa(): Exa {
  if (!process.env.EXA_API_KEY) throw new Error("EXA_API_KEY is not set");
  return (client ??= new Exa(process.env.EXA_API_KEY));
}

export type WebSearchOptions = {
  includeDomains?: string[];
  numResults?: number;
  maxCharacters?: number;
  startPublishedDate?: string;
  /** Re-fetch cached results older than this (stale results are served if the re-fetch fails). */
  maxAgeMs?: number;
};

// A search fans out to six vendors and deal lookups add more, which can trip Exa's per-network
// rate limit. Cap concurrent calls, and retry rate-limit / server errors briefly.
const MAX_CONCURRENT = 6;
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      if (attempt >= 2 || !(status === 429 || status >= 500)) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** Exa search with page text, cached in SQLite by query + options. */
export async function webSearch(query: string, opts: WebSearchOptions = {}): Promise<WebPage[]> {
  const options = {
    numResults: opts.numResults ?? 10,
    includeDomains: opts.includeDomains,
    startPublishedDate: opts.startPublishedDate,
    maxCharacters: opts.maxCharacters ?? 6000,
  };
  return cached(
    "exa",
    { query, ...options },
    async () => {
      const res = await withSlot(() =>
        retrying(() =>
          exa().search(query, {
            numResults: options.numResults,
            ...(options.includeDomains ? { includeDomains: options.includeDomains } : {}),
            ...(options.startPublishedDate ? { startPublishedDate: options.startPublishedDate } : {}),
            contents: { text: { maxCharacters: options.maxCharacters } },
          }),
        ),
      ).catch((err) => {
        throw new Error(`Exa web search failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      const cost = (res as { costDollars?: { total?: number } }).costDollars?.total;
      console.log(`[exa] ${cost != null ? `$${cost.toFixed(4)}` : "cost n/a"} ${JSON.stringify(query)} ${options.includeDomains?.join(",") ?? ""}`);
      return res.results
        .filter((r) => typeof r.text === "string" && r.text.length > 0)
        .map((r) => ({
          url: r.url,
          title: r.title ?? "",
          text: r.text as string,
          image: r.image ?? null,
          publishedDate: r.publishedDate ?? null,
        }));
    },
    (pages) => pages.length > 0,
    opts.maxAgeMs,
  );
}

// ---------- Product pages: find URLs cheaply, then read each page fresh ----------

export type SearchHit = { url: string; title: string };

/**
 * URLs and titles only (no page text). Which pages a store has for a query changes slowly and
 * carries no prices, so this is cached for a day.
 * Exa's "lite" search: measured at ~0.2s against ~2s for the default type on the same store query,
 * returning the same product pages, for less per call.
 */
export async function searchUrls(query: string, opts: { includeDomains: string[]; numResults: number }): Promise<SearchHit[]> {
  return cached(
    "exa-urls",
    { query, ...opts, type: "lite" },
    async () => {
      const t0 = Date.now();
      const res = await withSlot(() =>
        retrying(() =>
          exa().search(query, { type: "lite", numResults: opts.numResults, includeDomains: opts.includeDomains, contents: false }),
        ),
      ).catch((err) => {
        throw new Error(`Exa web search failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      const cost = (res as { costDollars?: { total?: number } }).costDollars?.total;
      console.log(
        `[exa] ${cost != null ? `$${cost.toFixed(4)}` : "cost n/a"} urls ${JSON.stringify(query)} ${opts.includeDomains.join(",")} ${Date.now() - t0}ms`,
      );
      return res.results.map((r) => ({ url: r.url, title: r.title ?? "" }));
    },
    (hits) => hits.length > 0,
    24 * 3600 * 1000,
  );
}

/** Exa re-fetches a page live when its stored copy is older than this, so prices are current. */
const PAGE_MAX_AGE_HOURS = 1;
/** Our own copy is only kept briefly, so a search repeated while typing doesn't pay twice. */
const PAGE_CACHE_MS = 10 * 60 * 1000;
/** A page that takes longer than this to crawl is skipped, so one slow page can't hold up a store's results. */
const LIVECRAWL_TIMEOUT_MS = 5_000;

/**
 * Page reads run one page per request, so they get their own, wider lane than searches: wide enough
 * for a whole search (6 stores x 6 pages) at once, since slow stores hold a slot for the full crawl
 * timeout and anything queued behind them would wait that long too.
 */
const MAX_CONCURRENT_PAGES = 40;
let activePages = 0;
const waitingPages: (() => void)[] = [];

async function withPageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activePages >= MAX_CONCURRENT_PAGES) await new Promise<void>((resolve) => waitingPages.push(resolve));
  activePages++;
  try {
    return await fn();
  } finally {
    activePages--;
    waitingPages.shift()?.();
  }
}

/**
 * Current text of these pages. Prices come from here, so nothing older than an hour is used:
 * Exa live-crawls stale pages, and our cache only de-duplicates requests within ten minutes.
 * Each page is its own request and `onPage` is called as each one arrives, so a page that crawls
 * in one second is used straight away instead of waiting for the slowest page. Pages Exa can't fetch
 * are left out; if every read fails, that's an outage or a bad key, and it throws.
 */
export async function freshPages(urls: string[], maxCharacters = 6000, onPage?: (page: WebPage) => void): Promise<WebPage[]> {
  const unique = [...new Set(urls)];
  const keyFor = (url: string) => `page:${hashKey({ url, maxCharacters })}`;
  const now = Date.now();
  const have = new Map<string, WebPage>();
  for (const url of unique) {
    const row = db.prepare("SELECT value, created_at FROM cache WHERE key = ?").get(keyFor(url)) as
      | { value: string; created_at: number }
      | undefined;
    if (row && now - row.created_at < PAGE_CACHE_MS) {
      const page = JSON.parse(row.value) as WebPage;
      have.set(url, page);
      onPage?.(page);
    }
  }
  const missing = unique.filter((u) => !have.has(u));
  if (missing.length) {
    const t0 = Date.now();
    let cost = 0;
    let costKnown = false;
    const put = db.prepare("INSERT OR REPLACE INTO cache (key, namespace, value, created_at) VALUES (?, 'page', ?, ?)");
    const reads = await Promise.allSettled(
      missing.map(async (url) => {
        const res = await withPageSlot(() =>
          retrying(() =>
            exa().getContents([url], { text: { maxCharacters }, maxAgeHours: PAGE_MAX_AGE_HOURS, livecrawlTimeout: LIVECRAWL_TIMEOUT_MS }),
          ),
        );
        const c = (res as { costDollars?: { total?: number } }).costDollars?.total;
        if (c != null) {
          cost += c;
          costKnown = true;
        }
        for (const r of res.results) {
          if (typeof r.text !== "string" || !r.text) continue;
          // Exa echoes the requested URL as `id`; `url` can be a canonicalized form of it.
          const requested = missing.includes(r.id) ? r.id : r.url;
          const page: WebPage = { url: requested, title: r.title ?? "", text: r.text, image: r.image ?? null, publishedDate: r.publishedDate ?? null };
          have.set(requested, page);
          put.run(keyFor(requested), JSON.stringify(page), Date.now());
          onPage?.(page);
        }
      }),
    );
    let host = "?";
    try {
      host = new URL(missing[0]).hostname.replace(/^www\./, "");
    } catch {}
    console.log(`[exa] ${costKnown ? `$${cost.toFixed(4)}` : "cost n/a"} pages x${missing.length} ${host} ${Date.now() - t0}ms`);
    const failed = reads.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length === missing.length) {
      const err = failed[0].reason;
      throw new Error(`Exa page fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return unique.flatMap((u) => (have.has(u) ? [have.get(u)!] : []));
}
