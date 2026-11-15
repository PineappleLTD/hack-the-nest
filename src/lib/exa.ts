import Exa from "exa-js";
import { cached } from "./db";

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
