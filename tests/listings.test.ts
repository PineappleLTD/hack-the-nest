import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { priceCheck, recommendPrice } from "@/lib/listings";
import { structured, tryStructured } from "@/lib/llm";
import { exa, exaError } from "./helpers/exa-mock";
import { fakeExtraction, installWeb, productPage, type FakePage } from "./helpers/web";

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, structured: vi.fn(), tryStructured: vi.fn() };
});

type StructuredFn = (name: string, schema: unknown, system: string, user: string) => Promise<unknown>;
const llm = structured as unknown as Mock<StructuredFn>;
const copyLlm = tryStructured as unknown as Mock<StructuredFn>;

const COPY = {
  listings: [
    { market: "ebay", title: "Nintendo Switch OLED Model White 64GB - Good Condition", description: "- Works great\n- Ships quickly" },
    { market: "mercari", title: "Switch OLED White 64GB", description: "- Works great" },
    { market: "facebook", title: "Nintendo Switch OLED - great shape", description: "Local pickup available." },
  ],
};

beforeEach(() => {
  llm.mockReset();
  llm.mockImplementation(async (name, _schema, _system, user) => (name === "product_extraction" ? fakeExtraction(user) : null));
  copyLlm.mockReset();
  copyLlm.mockResolvedValue(COPY);
});

const EBAY = [
  productPage("https://www.ebay.com/itm/387000000001", "Nintendo Switch OLED - FOR PARTS, no power", "12.00"),
  productPage("https://www.ebay.com/itm/387000000002", "Nintendo Switch OLED Model White Pre-Owned", "245.00"),
  productPage("https://www.ebay.com/itm/Nintendo-Switch-OLED/387000000003", "Nintendo Switch OLED Model Neon Pre-Owned", "260.00"),
  productPage("https://www.ebay.com/itm/387000000004", "Nintendo Switch OLED White with Case Pre-Owned", "279.99"),
];
const MERCARI = [
  productPage("https://www.mercari.com/us/item/m11111111111/", "Nintendo Switch OLED white", "229.00"),
  productPage("https://www.mercari.com/us/item/m22222222222/", "Switch OLED console + dock", "250.00"),
];
const EBAY_PRICES = [12, 245, 260, 279.99];
const MERCARI_PRICES = [229, 250];

function sellWeb(extra: Partial<Record<string, string[]>> = {}, pages: FakePage[] = []) {
  installWeb({
    hits: {
      "ebay.com": ["https://www.ebay.com/sch/i.html?_nkw=switch+oled", ...EBAY.map((p) => p.url)],
      "mercari.com": ["https://www.mercari.com/search/?keyword=switch%20oled", ...MERCARI.map((p) => p.url)],
      // Facebook Marketplace is login-walled: only search pages get indexed.
      "facebook.com": ["https://www.facebook.com/marketplace/nyc/search?query=switch%20oled"],
      ...extra,
    } as Record<string, string[]>,
    pages: [...EBAY, ...MERCARI, ...pages],
  });
}

const INPUT = { item: "Nintendo Switch OLED", condition: "Good", notes: "white, 64GB, includes dock" };

describe("recommendPrice", () => {
  it("is null with no comps", () => {
    expect(recommendPrice([])).toBeNull();
  });

  it("sits a touch under the lowest credible comp and ends in .99", () => {
    expect(recommendPrice([100])).toBe(96.99);
    expect(recommendPrice([245, 260, 279.99])).toBe(236.99);
  });

  it("ignores extreme low outliers (parts-only listings)", () => {
    expect(recommendPrice([12, 245, 260, 279.99])).toBe(236.99);
    expect(recommendPrice([20, 200, 220, 250])).toBe(193.99);
  });

  it("never goes below $0.99", () => {
    expect(recommendPrice([0.5])).toBe(0.99);
  });

  it.each([[[19.99]], [[54, 61.5, 70]], [[1299.99, 1350]], [[245, 260]]])("ends in .99 for %j", (prices) => {
    const r = recommendPrice(prices)!;
    expect(Math.round(r * 100) % 100).toBe(99);
    expect(r).toBeLessThan(Math.min(...prices));
  });
});

describe("priceCheck", () => {
  it("finds per-market comps with the fresh two-step flow (URL search, then <=1h-old pages)", async () => {
    sellWeb();
    await priceCheck(INPUT);
    expect(exa.search).toHaveBeenCalledWith("Nintendo Switch OLED Good listing", { numResults: 15, includeDomains: ["ebay.com"], contents: false });
    expect(exa.search).toHaveBeenCalledWith("Nintendo Switch OLED Good for sale", { numResults: 15, includeDomains: ["mercari.com"], contents: false });
    expect(exa.search).toHaveBeenCalledWith("Nintendo Switch OLED Good marketplace for sale", {
      numResults: 15,
      includeDomains: ["facebook.com"],
      contents: false,
    });
    const fetched = exa.getContents.mock.calls.flatMap(([urls]) => urls);
    expect(fetched).not.toContain("https://www.ebay.com/sch/i.html?_nkw=switch+oled");
    expect(fetched.some((u) => u.includes("facebook.com"))).toBe(false);
    for (const [, opts] of exa.getContents.mock.calls) {
      expect(opts?.maxAgeHours).toBeLessThanOrEqual(1);
      expect(opts?.text).toEqual({ maxCharacters: 5000 });
    }
  });

  it("reports comps, range and a recommended price for markets with listings (estimatedFrom null)", async () => {
    sellWeb();
    const { markets } = await priceCheck(INPUT);
    const ebay = markets.find((m) => m.market === "ebay")!;
    const mercari = markets.find((m) => m.market === "mercari")!;
    expect(ebay.comps.map((c) => c.price)).toEqual(EBAY_PRICES);
    expect(ebay).toMatchObject({ marketName: "eBay", low: 12, high: 279.99, median: 252.5, recommended: 236.99, estimatedFrom: null });
    expect(mercari).toMatchObject({ low: 229, high: 250, median: 239.5, recommended: 221.99, estimatedFrom: null });
    expect(ebay.comps[0].vendor).toBe("ebay");
  });

  it("estimates Facebook (no comps) from eBay + Mercari comps and says so", async () => {
    sellWeb();
    const { markets } = await priceCheck(INPUT);
    const fb = markets.find((m) => m.market === "facebook")!;
    expect(fb.comps).toEqual([]);
    expect(fb.low).toBeNull();
    expect(fb.median).toBeNull();
    expect(fb.recommended).toBe(recommendPrice([...EBAY_PRICES, ...MERCARI_PRICES]));
    expect(fb.recommended).toBe(221.99);
    expect(fb.estimatedFrom).toEqual(["eBay", "Mercari"]);
  });

  it("reads at most 8 listing pages per market", async () => {
    const many = Array.from({ length: 12 }, (_, i) => productPage(`https://www.ebay.com/itm/3880000000${10 + i}`, `Switch OLED #${i}`, `${250 + i}.00`));
    sellWeb({ "ebay.com": many.map((p) => p.url) }, many);
    const { markets } = await priceCheck(INPUT);
    const ebayFetch = exa.getContents.mock.calls.find(([urls]) => urls[0].includes("ebay.com"))!;
    expect(ebayFetch[0]).toHaveLength(8);
    expect(markets[0].comps).toHaveLength(8);
  });

  it("uses Claude's listing copy per market", async () => {
    sellWeb();
    const { markets } = await priceCheck(INPUT);
    expect(markets.map((m) => m.title)).toEqual(COPY.listings.map((l) => l.title));
    expect(copyLlm.mock.calls[0][0]).toBe("listing_copy");
    expect(copyLlm.mock.calls[0][3]).toContain("Seller notes: white, 64GB, includes dock");
  });

  it("falls back to plain listing copy when the LLM returns null", async () => {
    sellWeb();
    copyLlm.mockResolvedValue(null);
    const { markets } = await priceCheck(INPUT);
    for (const m of markets) {
      expect(m.title).toBe("Nintendo Switch OLED - Good");
      expect(m.description).toBe("Nintendo Switch OLED\nCondition: Good\nwhite, 64GB, includes dock");
    }
  });

  it("falls back per market when the copy is missing one market", async () => {
    sellWeb();
    copyLlm.mockResolvedValue({ listings: COPY.listings.filter((l) => l.market !== "mercari") });
    const { markets } = await priceCheck(INPUT);
    expect(markets.find((m) => m.market === "mercari")!.title).toBe("Nintendo Switch OLED - Good");
    expect(markets.find((m) => m.market === "ebay")!.title).toBe(COPY.listings[0].title);
  });

  it("a failing market leaves only that market empty", async () => {
    sellWeb();
    const ok = exa.search.getMockImplementation()!;
    exa.search.mockImplementation(async (q, opts) => {
      if (opts?.includeDomains?.[0] === "mercari.com") throw exaError(400, "bad request");
      return ok(q, opts);
    });
    const { markets } = await priceCheck(INPUT);
    const [ebay, mercari, fb] = markets;
    expect(ebay.comps).toHaveLength(4);
    expect(mercari.comps).toEqual([]);
    expect(mercari.estimatedFrom).toEqual(["eBay"]);
    expect(mercari.recommended).toBe(recommendPrice(EBAY_PRICES));
    expect(fb.estimatedFrom).toEqual(["eBay"]);
  });

  it("an invalid Claude key surfaces as an error (every market failed, no comps)", async () => {
    sellWeb();
    llm.mockRejectedValue(new Error("Claude rejected the API key (check ANTHROPIC_API_KEY)"));
    await expect(priceCheck(INPUT)).rejects.toThrow("Claude rejected the API key (check ANTHROPIC_API_KEY)");
  });

  it("an invalid Exa key surfaces as an error", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    await expect(priceCheck(INPUT)).rejects.toThrow("Exa web search failed: Invalid API key");
  });

  it("a missing EXA_API_KEY surfaces as an error", async () => {
    vi.stubEnv("EXA_API_KEY", "");
    await expect(priceCheck(INPUT)).rejects.toThrow("EXA_API_KEY is not set");
  });

  it("no comps anywhere (and no failures) gives nulls, not an estimate or an error", async () => {
    installWeb({ hits: {}, pages: [] });
    const { markets } = await priceCheck(INPUT);
    for (const m of markets) {
      expect(m.comps).toEqual([]);
      expect(m.recommended).toBeNull();
      expect(m.estimatedFrom).toBeNull();
    }
  });

  it("reports whether eBay posting and Stripe are configured", async () => {
    sellWeb();
    expect(await priceCheck(INPUT)).toMatchObject({ ebayEnabled: false, stripeEnabled: false, input: INPUT });
    vi.stubEnv("EBAY_OAUTH_TOKEN", "fake-ebay-token");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    expect(await priceCheck(INPUT)).toMatchObject({ ebayEnabled: true, stripeEnabled: true });
  });

  it("reuses a report for the same item briefly (no second Exa search)", async () => {
    sellWeb();
    await priceCheck(INPUT);
    const calls = exa.search.mock.calls.length;
    await priceCheck({ ...INPUT, item: "  nintendo switch oled " });
    expect(exa.search.mock.calls.length).toBe(calls);
  });
});
