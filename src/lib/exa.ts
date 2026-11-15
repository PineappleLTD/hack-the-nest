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
      const res = await exa().search(query, {
        numResults: options.numResults,
        ...(options.includeDomains ? { includeDomains: options.includeDomains } : {}),
        ...(options.startPublishedDate ? { startPublishedDate: options.startPublishedDate } : {}),
        contents: { text: { maxCharacters: options.maxCharacters } },
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
