import { afterEach, describe, expect, it, vi } from "vitest";
import { freshPages, searchUrls, webSearch } from "@/lib/exa";
import { db } from "@/lib/db";
import { exa, exaError } from "./helpers/exa-mock";
import { ALTOIDS_LIVE_TEXT, ALTOIDS_STALE_TEXT, ALTOIDS_TITLE, ALTOIDS_URL } from "./helpers/web";

afterEach(() => {
  vi.useRealTimers();
});

const MIN = 60_000;
const HOUR = 60 * MIN;

function hits(...urls: string[]) {
  return { results: urls.map((url) => ({ id: url, url, title: `Title of ${url}` })) };
}

function pages(...ps: { url: string; text: string; title?: string; id?: string }[]) {
  return { results: ps.map((p) => ({ id: p.id ?? p.url, url: p.url, title: p.title ?? "", text: p.text })) };
}

describe("searchUrls", () => {
  it("is a URL-only search (contents: false) restricted to the given domains", async () => {
    exa.search.mockResolvedValue(hits("https://www.amazon.com/dp/B00N9TAZHW"));
    const res = await searchUrls("altoids", { includeDomains: ["amazon.com"], numResults: 15 });
    expect(res).toEqual([{ url: "https://www.amazon.com/dp/B00N9TAZHW", title: "Title of https://www.amazon.com/dp/B00N9TAZHW" }]);
    expect(exa.search).toHaveBeenCalledWith("altoids", { numResults: 15, includeDomains: ["amazon.com"], contents: false });
    expect(exa.keys).toEqual(["test-exa-key-not-real"]);
  });

  it("caches hits for 24 hours under the exa-urls namespace", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    exa.search.mockResolvedValue(hits("https://www.amazon.com/dp/B00N9TAZHW"));
    const opts = { includeDomains: ["amazon.com"], numResults: 15 };
    await searchUrls("altoids", opts);
    vi.setSystemTime(new Date("2026-11-16T07:59:00Z"));
    await searchUrls("altoids", opts);
    expect(exa.search).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cache WHERE namespace = 'exa-urls'").get()).toEqual({ n: 1 });
    vi.setSystemTime(new Date("2026-11-16T08:01:00Z"));
    await searchUrls("altoids", opts);
    expect(exa.search).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty result", async () => {
    exa.search.mockResolvedValue({ results: [] });
    const opts = { includeDomains: ["etsy.com"], numResults: 15 };
    await searchUrls("zzz", opts);
    await searchUrls("zzz", opts);
    expect(exa.search).toHaveBeenCalledTimes(2);
  });

  it("an invalid key surfaces as 'Exa web search failed: ...' and is not retried", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    await expect(searchUrls("x", { includeDomains: ["amazon.com"], numResults: 15 })).rejects.toThrow(
      "Exa web search failed: Invalid API key",
    );
    expect(exa.search).toHaveBeenCalledTimes(1);
  });

  it("a missing EXA_API_KEY surfaces as an error", async () => {
    vi.stubEnv("EXA_API_KEY", "");
    await expect(searchUrls("x", { includeDomains: ["amazon.com"], numResults: 15 })).rejects.toThrow(
      "Exa web search failed: EXA_API_KEY is not set",
    );
    expect(exa.search).not.toHaveBeenCalled();
  });

  it("retries a 429 after a short wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    exa.search.mockRejectedValueOnce(exaError(429, "Too many requests")).mockResolvedValueOnce(hits("https://www.ebay.com/itm/1"));
    const p = searchUrls("x", { includeDomains: ["ebay.com"], numResults: 15 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toHaveLength(1);
    expect(exa.search).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts on repeated 5xx", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    exa.search.mockRejectedValue(exaError(503, "Service unavailable"));
    const p = expect(searchUrls("x", { includeDomains: ["ebay.com"], numResults: 15 })).rejects.toThrow(
      "Exa web search failed: Service unavailable",
    );
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(exa.search).toHaveBeenCalledTimes(3);
  });

  it("never has more than 6 Exa calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    exa.search.mockImplementation(async (q: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return hits(`https://www.ebay.com/itm/${q.length}`);
    });
    const all = Array.from({ length: 20 }, (_, i) => searchUrls("q".repeat(i + 1), { includeDomains: ["ebay.com"], numResults: 15 }));
    await Promise.all(all);
    expect(exa.search).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBe(6);
  });
});

// Incident 1: Exa's stored copy said "Price: 10.98 USD"; live it's "$24.62".
describe("freshPages", () => {
  it("asks Exa for page text no older than an hour (maxAgeHours <= 1)", async () => {
    exa.getContents.mockResolvedValue(pages({ url: ALTOIDS_URL, text: ALTOIDS_LIVE_TEXT, title: ALTOIDS_TITLE }));
    const res = await freshPages([ALTOIDS_URL]);
    expect(res).toEqual([{ url: ALTOIDS_URL, title: ALTOIDS_TITLE, text: ALTOIDS_LIVE_TEXT, image: null, publishedDate: null }]);
    expect(exa.getContents).toHaveBeenCalledTimes(1);
    const [urls, opts] = exa.getContents.mock.calls[0];
    expect(urls).toEqual([ALTOIDS_URL]);
    expect(opts?.maxAgeHours).toBeDefined();
    expect(opts!.maxAgeHours!).toBeLessThanOrEqual(1);
    expect(opts?.text).toEqual({ maxCharacters: 6000 });
    // A live crawl is bounded so one slow page can't stall a store.
    expect(opts?.livecrawlTimeout).toBeGreaterThan(0);
    expect(opts!.livecrawlTimeout!).toBeLessThanOrEqual(10_000);
  });

  it("passes a custom maxCharacters through", async () => {
    exa.getContents.mockResolvedValue(pages({ url: ALTOIDS_URL, text: "x" }));
    await freshPages([ALTOIDS_URL], 5000);
    expect(exa.getContents.mock.calls[0][1]?.text).toEqual({ maxCharacters: 5000 });
  });

  it("serves its own copy within 10 minutes and re-fetches after (the stale Altoids price)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    exa.getContents
      .mockResolvedValueOnce(pages({ url: ALTOIDS_URL, text: ALTOIDS_STALE_TEXT }))
      .mockResolvedValueOnce(pages({ url: ALTOIDS_URL, text: ALTOIDS_LIVE_TEXT }));

    expect((await freshPages([ALTOIDS_URL]))[0].text).toContain("10.98 USD");
    vi.setSystemTime(new Date("2026-11-15T08:09:00Z"));
    expect((await freshPages([ALTOIDS_URL]))[0].text).toContain("10.98 USD");
    expect(exa.getContents).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-15T08:10:30Z"));
    const later = await freshPages([ALTOIDS_URL]);
    expect(exa.getContents).toHaveBeenCalledTimes(2);
    expect(later[0].text).toContain("$24.62");
    expect(later[0].text).not.toContain("10.98");
  });

  it("only fetches the pages it doesn't already have, once each", async () => {
    const a = "https://www.ebay.com/itm/1";
    const b = "https://www.ebay.com/itm/2";
    exa.getContents.mockImplementation(async (urls: string[]) => pages(...urls.map((url) => ({ url, text: `text ${url}` }))));
    await freshPages([a]);
    const res = await freshPages([b, a, b]);
    expect(exa.getContents.mock.calls.map(([urls]) => urls)).toEqual([[a], [b]]);
    expect(res.map((p) => p.url)).toEqual([b, a]);
  });

  it("caches page text in the page namespace for each maxCharacters separately", async () => {
    exa.getContents.mockImplementation(async (urls: string[]) => pages(...urls.map((url) => ({ url, text: "t" }))));
    await freshPages([ALTOIDS_URL], 6000);
    await freshPages([ALTOIDS_URL], 5000);
    expect(exa.getContents).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cache WHERE namespace = 'page'").get()).toEqual({ n: 2 });
  });

  it("matches results back to the requested URL via id when Exa canonicalizes the url", async () => {
    const requested = "https://www.amazon.com/Altoids-Arctic-Peppermint-Mints-Pack/dp/B00N9TAZHW?th=1&psc=1";
    exa.getContents.mockResolvedValue(pages({ id: requested, url: "https://www.amazon.com/dp/B00N9TAZHW", text: ALTOIDS_LIVE_TEXT }));
    const res = await freshPages([requested]);
    expect(res).toHaveLength(1);
    expect(res[0].url).toBe(requested);
    // ...and the cached copy is found under the requested URL too.
    await freshPages([requested]);
    expect(exa.getContents).toHaveBeenCalledTimes(1);
  });

  it("leaves out pages Exa couldn't fetch or that have no text, keeping request order", async () => {
    const [a, b, c] = ["https://www.target.com/p/a/-/A-1", "https://www.target.com/p/b/-/A-2", "https://www.target.com/p/c/-/A-3"];
    exa.getContents.mockResolvedValue({
      results: [
        { id: c, url: c, title: "C", text: "page c" },
        { id: b, url: b, title: "B", text: "" },
      ],
    });
    const res = await freshPages([a, b, c]);
    expect(res.map((p) => p.url)).toEqual([c]);
  });

  it("does not call Exa at all for an empty list", async () => {
    expect(await freshPages([])).toEqual([]);
    expect(exa.getContents).not.toHaveBeenCalled();
  });

  it("surfaces errors as 'Exa page fetch failed: ...'", async () => {
    exa.getContents.mockRejectedValue(exaError(401, "Invalid API key"));
    await expect(freshPages([ALTOIDS_URL])).rejects.toThrow("Exa page fetch failed: Invalid API key");
  });
});

describe("webSearch", () => {
  it("searches with page text and only passes optional filters that are set", async () => {
    exa.search.mockResolvedValue({
      results: [
        { id: "1", url: "https://www.target.com/circle/deals", title: "Deals", text: "20% off", publishedDate: "2026-11-10" },
        { id: "2", url: "https://www.retailmenot.com/view/target.com", title: "Coupons", text: "" },
      ],
    });
    const res = await webSearch("Target promo codes", { numResults: 8, maxCharacters: 8000, startPublishedDate: "2026-10-01T00:00:00.000Z" });
    expect(exa.search).toHaveBeenCalledWith("Target promo codes", {
      numResults: 8,
      startPublishedDate: "2026-10-01T00:00:00.000Z",
      contents: { text: { maxCharacters: 8000 } },
    });
    expect(res).toEqual([
      { url: "https://www.target.com/circle/deals", title: "Deals", text: "20% off", image: null, publishedDate: "2026-11-10" },
    ]);
  });

  it("refreshes after maxAgeMs, retrying a 5xx", async () => {
    exa.search
      .mockResolvedValueOnce({ results: [{ id: "1", url: "https://a.example/1", title: "", text: "old" }] })
      .mockRejectedValueOnce(exaError(500, "boom"))
      .mockResolvedValueOnce({ results: [{ id: "1", url: "https://a.example/1", title: "", text: "new" }] });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    expect((await webSearch("q", { maxAgeMs: 12 * HOUR }))[0].text).toBe("old");
    vi.setSystemTime(new Date("2026-11-15T21:00:00Z"));
    // The 500 is retried once (after 1s) and the retry succeeds with fresh text.
    const p = webSearch("q", { maxAgeMs: 12 * HOUR });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p)[0].text).toBe("new");
  });

  it("serves the stale copy when every refresh attempt fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    exa.search.mockResolvedValueOnce({ results: [{ id: "1", url: "https://a.example/1", title: "", text: "old" }] });
    await webSearch("q", { maxAgeMs: 12 * HOUR });
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    vi.setSystemTime(new Date("2026-11-15T21:00:00Z"));
    expect((await webSearch("q", { maxAgeMs: 12 * HOUR }))[0].text).toBe("old");
  });

  it("surfaces errors as 'Exa web search failed: ...' when nothing is cached", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    await expect(webSearch("q")).rejects.toThrow("Exa web search failed: Invalid API key");
  });
});
