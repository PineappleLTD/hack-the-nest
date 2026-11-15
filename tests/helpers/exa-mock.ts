/**
 * Stand-in for the `exa-js` package. tests/setup.ts mocks "exa-js" with this module for every test
 * file, so no test can reach the real Exa API. Tests drive it through `exa.search` / `exa.getContents`.
 */
import { vi } from "vitest";

export type ExaResult = {
  id: string;
  url: string;
  title?: string | null;
  text?: string;
  image?: string;
  publishedDate?: string;
};
export type ExaResponse = { results: ExaResult[]; costDollars?: { total?: number } };
export type SearchOptions = {
  numResults?: number;
  includeDomains?: string[];
  startPublishedDate?: string;
  contents?: false | { text?: { maxCharacters?: number } };
};
export type ContentsOptions = { text?: { maxCharacters?: number }; maxAgeHours?: number; livecrawlTimeout?: number };

const unstubbed = (method: string) => async (): Promise<ExaResponse> => {
  throw new Error(`exa.${method} was called but this test did not stub it`);
};

export const exa = {
  search: vi.fn<(query: string, opts?: SearchOptions) => Promise<ExaResponse>>(unstubbed("search")),
  getContents: vi.fn<(urls: string[], opts?: ContentsOptions) => Promise<ExaResponse>>(unstubbed("getContents")),
  /** API keys passed to `new Exa(key)`. */
  keys: [] as string[],
};

export function resetExa() {
  exa.search.mockReset();
  exa.getContents.mockReset();
  exa.keys.length = 0;
}

/** An Exa-style API error (exa-js throws `ExaError` with `statusCode`). */
export function exaError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { name: "ExaError", statusCode });
}

export default class FakeExa {
  constructor(apiKey: string) {
    exa.keys.push(apiKey);
  }
  search(query: string, opts?: SearchOptions) {
    return exa.search(query, opts);
  }
  getContents(urls: string[], opts?: ContentsOptions) {
    return exa.getContents(urls, opts);
  }
}
