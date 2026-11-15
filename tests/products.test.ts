import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  applyFilter,
  dropImplausible,
  extractProduct,
  filterProducts,
  priceIsGrounded,
  searchProducts,
  titleTokens,
  type FilterSpec,
} from "@/lib/products";
import { structured } from "@/lib/llm";
import { SHOP_VENDORS } from "@/lib/vendors";
import { exa, exaError } from "./helpers/exa-mock";
import { product } from "./helpers/data";
import {
  ALTOIDS_LIVE_TEXT,
  ALTOIDS_STALE_TEXT,
  ALTOIDS_TITLE,
  ALTOIDS_URL,
  fakeExtraction,
  fetchedUrls,
  installWeb,
  productPage,
  type Extraction,
  type FakePage,
} from "./helpers/web";

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, structured: vi.fn(), tryStructured: vi.fn(async () => null) };
});

type StructuredFn = (name: string, schema: unknown, system: string, user: string) => Promise<unknown>;
const llm = structured as unknown as Mock<StructuredFn>;
let overrides: Record<string, Partial<Extraction>> = {};

beforeEach(() => {
  overrides = {};
  llm.mockReset();
  llm.mockImplementation(async (name, _schema, _system, user) => (name === "product_extraction" ? fakeExtraction(user, overrides) : null));
});

afterEach(() => {
  vi.useRealTimers();
});

const vendor = (id: string) => SHOP_VENDORS.find((v) => v.id === id)!;
const CLAUDE_KEY_ERROR = "Claude rejected the API key (check ANTHROPIC_API_KEY)";

describe("priceIsGrounded", () => {
  it("accepts a price quoted exactly from the page", () => {
    expect(priceIsGrounded(ALTOIDS_LIVE_TEXT, "$24.62", 24.62)).toBe(true);
  });

  it("rejects the stale Altoids price when the page now says $24.62", () => {
    expect(priceIsGrounded(ALTOIDS_LIVE_TEXT, "Price: 10.98 USD", 10.98)).toBe(false);
    expect(priceIsGrounded(ALTOIDS_LIVE_TEXT, "$10.98", 10.98)).toBe(false);
  });

  it("rejects a quote that disagrees with the number", () => {
    expect(priceIsGrounded(ALTOIDS_LIVE_TEXT, "$24.62", 10.98)).toBe(false);
  });

  it("tolerates whitespace differences and thousands separators", () => {
    expect(priceIsGrounded("LEGO Millennium Falcon\n$1,289.99\n", "$1,289.99", 1289.99)).toBe(true);
    expect(priceIsGrounded("Now  US $14.95  shipping", "US $14.95", 14.95)).toBe(true);
  });

  it("rejects a quote that is only a prefix of the page's price ($14 vs $149.99)", () => {
    const text = "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black\nPrice: $149.99";
    expect(priceIsGrounded(text, "$14", 14)).toBe(false);
  });

  it.each([
    [null, 10],
    ["$10.00", null],
    ["$0.00", 0],
    ["$-5.00", -5],
  ])("rejects missing or non-positive prices (%s, %s)", (text, price) => {
    expect(priceIsGrounded("$10.00 $0.00 $-5.00", text, price)).toBe(false);
  });
});

describe("extractProduct", () => {
  const page = { url: ALTOIDS_URL, title: ALTOIDS_TITLE, text: ALTOIDS_LIVE_TEXT, image: null, publishedDate: null };

  it("returns a grounded product whose URL and vendor come from the page, never the model", async () => {
    llm.mockResolvedValueOnce({ ...fakeExtraction(`URL: x\n\nPage text:\n${ALTOIDS_LIVE_TEXT}`), url: "https://evil.example/buy", vendor: "walmart" });
    const p = await extractProduct(page, "altoids arctic", vendor("amazon"));
    expect(p).toMatchObject({ id: ALTOIDS_URL, url: ALTOIDS_URL, price: 24.62, currency: "USD", vendor: "amazon", vendorName: "Amazon" });
    expect(llm.mock.calls[0][0]).toBe("product_extraction");
    expect(llm.mock.calls[0][3]).toContain(`URL: ${ALTOIDS_URL}`);
    expect(llm.mock.calls[0][3]).toContain(ALTOIDS_LIVE_TEXT);
  });

  it.each<[string, Partial<Extraction>]>([
    ["not a single product page", { isSingleProductPage: false }],
    ["not a match for the query", { matchesQuery: false }],
    ["a price that isn't on the page", { priceText: "$10.98", price: 10.98 }],
    ["no price", { priceText: null, price: null }],
    ["a non-USD price", { currency: "EUR" }],
  ])("returns null for %s", async (_label, o) => {
    overrides[ALTOIDS_URL] = o;
    expect(await extractProduct(page, "altoids", vendor("amazon"))).toBeNull();
  });

  it("returns null when the model returns null", async () => {
    llm.mockResolvedValueOnce(null);
    expect(await extractProduct(page, "altoids", vendor("amazon"))).toBeNull();
  });

  it("uses the page image, or a model image URL only if it is https and literally on the page", async () => {
    const img = "https://m.media-amazon.com/images/I/71altoids.jpg";
    overrides[ALTOIDS_URL] = { imageUrl: img };
    expect((await extractProduct({ ...page, text: `${ALTOIDS_LIVE_TEXT}\n${img}` }, "a", vendor("amazon")))?.imageUrl).toBe(img);
    expect((await extractProduct(page, "b", vendor("amazon")))?.imageUrl).toBeNull();
    expect((await extractProduct({ ...page, image: "https://img.example/x.png" }, "c", vendor("amazon")))?.imageUrl).toBe(
      "https://img.example/x.png",
    );
  });

  it("throws on LLM errors so callers can surface them", async () => {
    llm.mockRejectedValueOnce(new Error(CLAUDE_KEY_ERROR));
    await expect(extractProduct(page, "altoids", vendor("amazon"))).rejects.toThrow(CLAUDE_KEY_ERROR);
  });
});

// ---------- searchProducts ----------

/** Broad "pokemon" search: each store returns some product pages and plenty of search/category pages. */
function pokemonWeb() {
  const amazonProducts = Array.from({ length: 9 }, (_, i) => `https://www.amazon.com/Pokemon-Item-${i}/dp/B0POKEMON${i}`);
  const pages: FakePage[] = [
    ...amazonProducts.map((u, i) => productPage(u, `Pokemon TCG Booster Bundle Series ${i}`, `${(20 + i).toFixed(2)}`)),
    productPage("https://www.ebay.com/itm/256111111111", "Pokemon Charizard ex 223/197 Obsidian Flames", "5.00"),
    productPage("https://www.ebay.com/itm/Pokemon-Pikachu-Plush/256222222222", "Pokemon Pikachu Plush 8 inch", "14.99"),
    productPage("https://www.etsy.com/listing/1234567890/pikachu-crochet", "Pikachu Crochet Amigurumi", "32.00"),
    productPage("https://www.etsy.com/il-en/listing/1234567891/eevee-lamp", "Eevee Night Lamp", "41.50"),
    productPage("https://www.bestbuy.com/site/pokemon-scarlet-nintendo-switch/6512345.p?skuId=6512345", "Pokemon Scarlet - Nintendo Switch", "59.99"),
    productPage("https://www.bestbuy.com/product/pokemon-violet-nintendo-switch/J3ZYG2C5H8", "Pokemon Violet - Nintendo Switch", "114.99"),
    productPage("https://www.walmart.com/ip/Pokemon-Pokedex-Book/123456789", "Pokemon Deluxe Essential Handbook", "22.00"),
    productPage("https://www.target.com/p/pokemon-legends-arceus-nintendo-switch/-/A-84123456", "Pokemon Legends Arceus", "49.99"),
  ];
  const hits: Record<string, string[]> = {
    "amazon.com": [
      "https://www.amazon.com/s?k=pokemon",
      amazonProducts[0],
      "https://www.amazon.com/b?node=166220011",
      amazonProducts[1],
      "https://www.amazon.com/zgbs/toys-and-games",
      amazonProducts[2],
      amazonProducts[2], // duplicate hit
      "https://www.amazon.com/gp/bestsellers/toys-and-games",
      amazonProducts[3],
      "https://www.amazon.co.uk/dp/B0POKEMONX", // other country, not amazon.com
      amazonProducts[4],
      amazonProducts[5],
      amazonProducts[6],
      amazonProducts[7],
      amazonProducts[8],
    ],
    "ebay.com": ["https://www.ebay.com/b/Pokemon-Trading-Card-Game/183454/bn_1", "https://www.ebay.com/itm/256111111111", "https://www.ebay.com/itm/Pokemon-Pikachu-Plush/256222222222"],
    "etsy.com": ["https://www.etsy.com/market/pokemon", "https://www.etsy.com/listing/1234567890/pikachu-crochet", "https://www.etsy.com/il-en/listing/1234567891/eevee-lamp"],
    "bestbuy.com": [
      "https://www.bestbuy.com/site/shop/pokemon",
      "https://www.bestbuy.com/site/pokemon-scarlet-nintendo-switch/6512345.p?skuId=6512345",
      "https://www.bestbuy.com/product/pokemon-violet-nintendo-switch/J3ZYG2C5H8",
    ],
    "walmart.com": ["https://www.walmart.com/browse/toys/pokemon/4171_4191", "https://www.walmart.com/ip/Pokemon-Pokedex-Book/123456789"],
    "target.com": ["https://www.target.com/c/pokemon/-/N-5xtz4", "https://www.target.com/p/pokemon-legends-arceus-nintendo-switch/-/A-84123456"],
  };
  return { hits, pages, amazonProducts };
}

const NON_PRODUCT = /\/s\?k=|\/b\?node=|\/zgbs\/|\/gp\/bestsellers|\/market\/|\/c\/|\/site\/shop\/|\/browse\/|\/b\/|amazon\.co\.uk/;

describe("searchProducts", () => {
  it("searches each vendor for 15 URLs, URL-only, restricted to its domain", async () => {
    installWeb(pokemonWeb());
    await searchProducts("pokemon");
    expect(exa.search).toHaveBeenCalledTimes(6);
    for (const v of SHOP_VENDORS) {
      expect(exa.search).toHaveBeenCalledWith("pokemon", { numResults: 15, includeDomains: [v.domain], contents: false });
    }
  });

  it("reads at most 6 product pages per vendor and never fetches search or category pages", async () => {
    const web = pokemonWeb();
    installWeb(web);
    await searchProducts("pokemon");
    const fetched = fetchedUrls();
    expect(fetched.filter((u) => NON_PRODUCT.test(u))).toEqual([]);
    const amazonCall = exa.getContents.mock.calls.find(([urls]) => urls[0].includes("amazon.com"))!;
    expect(amazonCall[0]).toEqual(web.amazonProducts.slice(0, 6));
    expect(new Set(fetched).size).toBe(fetched.length);
  });

  it("gets broad coverage: every vendor's product pages become results, cheapest first", async () => {
    installWeb(pokemonWeb());
    const res = await searchProducts("pokemon");
    // 6 Amazon (capped) + 2 eBay + 2 Etsy + 2 Best Buy + 1 Walmart + 1 Target
    expect(res).toHaveLength(14);
    expect(new Set(res.map((p) => p.vendor))).toEqual(new Set(SHOP_VENDORS.map((v) => v.id)));
    const prices = res.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    // A broad search keeps cheap items: the $5 card and the $114.99 game are both there.
    expect(prices[0]).toBe(5);
    expect(prices).toContain(114.99);
  });

  it("reads page text fresh (Exa maxAgeHours <= 1) for every vendor", async () => {
    installWeb(pokemonWeb());
    await searchProducts("pokemon");
    expect(exa.getContents).toHaveBeenCalled();
    for (const [, opts] of exa.getContents.mock.calls) {
      expect(opts?.maxAgeHours).toBeLessThanOrEqual(1);
    }
  });

  // Incident 1, end to end: the URL search is cached for a day, but prices are not.
  it("re-reads the Altoids page after 10 minutes instead of reusing the day-old URL cache's era", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    const page = { url: ALTOIDS_URL, title: ALTOIDS_TITLE, text: ALTOIDS_STALE_TEXT };
    installWeb({ hits: { "amazon.com": [ALTOIDS_URL] }, pages: [page] });

    const first = await searchProducts("altoids arctic peppermint");
    expect(first.map((p) => p.price)).toEqual([10.98]);

    vi.setSystemTime(new Date("2026-11-15T08:05:00Z"));
    page.text = ALTOIDS_LIVE_TEXT;
    expect((await searchProducts("altoids arctic peppermint")).map((p) => p.price)).toEqual([10.98]);
    expect(exa.getContents).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-15T08:11:00Z"));
    const later = await searchProducts("altoids arctic peppermint");
    expect(later.map((p) => p.price)).toEqual([24.62]);
    expect(later[0].url).toBe(ALTOIDS_URL);
    expect(exa.getContents).toHaveBeenCalledTimes(2);
    // Amazon's URL search was served from the 24h cache; only the page text was re-read.
    expect(exa.search.mock.calls.filter(([, o]) => o?.includeDomains?.[0] === "amazon.com")).toHaveLength(1);
  });

  // Incident 6: plain search never runs the filter agent.
  it("only ever calls Claude for product_extraction, never filter_spec", async () => {
    installWeb(pokemonWeb());
    await searchProducts("pokemon");
    expect(llm).toHaveBeenCalled();
    const names = new Set(llm.mock.calls.map(([name]) => name));
    expect(names).toEqual(new Set(["product_extraction"]));
  });

  // Incident 3, end to end: ear pads listed as "Sony WH-1000XM5" at $14.95.
  it("drops the $14.95 'Sony WH-1000XM5' listing among real XM5 listings", async () => {
    const junk = productPage("https://www.ebay.com/itm/266000000001", "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black", "14.95");
    const real = [
      productPage("https://www.ebay.com/itm/266000000002", "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black (Renewed)", "159.99"),
      productPage("https://www.ebay.com/itm/266000000003", "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Silver", "228.00"),
      productPage("https://www.amazon.com/Sony-WH-1000XM5/dp/B09XS7JWHH", "Sony WH-1000XM5 Wireless Noise Canceling Headphones, Black", "248.00"),
      productPage("https://www.bestbuy.com/site/sony-wh1000xm5/6505727.p?skuId=6505727", "Sony - WH-1000XM5 Wireless Noise Canceling Headphones - Black", "298.00"),
    ];
    installWeb({
      hits: {
        "ebay.com": [junk.url, real[0].url, real[1].url],
        "amazon.com": [real[2].url],
        "bestbuy.com": [real[3].url],
      },
      pages: [junk, ...real],
    });
    const res = await searchProducts("sony wh-1000xm5");
    expect(res.map((p) => p.price)).toEqual([159.99, 228, 248, 298]);
  });

  // Incident 5: one vendor failing must not break the rest.
  it("returns the other vendors' results, sorted, when one vendor's Exa search rejects", async () => {
    const web = pokemonWeb();
    installWeb(web);
    const ok = exa.search.getMockImplementation()!;
    exa.search.mockImplementation(async (q, opts) => {
      if (opts?.includeDomains?.[0] === "ebay.com") throw new TypeError("fetch failed");
      return ok(q, opts);
    });
    const res = await searchProducts("pokemon");
    expect(res.length).toBe(12);
    expect(res.some((p) => p.vendor === "ebay")).toBe(false);
    const prices = res.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("returns the other vendors' results when one vendor's page fetch fails", async () => {
    installWeb(pokemonWeb());
    const ok = exa.getContents.getMockImplementation()!;
    exa.getContents.mockImplementation(async (urls, opts) => {
      if (urls[0].includes("etsy.com")) throw exaError(400, "bad request");
      return ok(urls, opts);
    });
    const res = await searchProducts("pokemon");
    expect(res.some((p) => p.vendor === "etsy")).toBe(false);
    expect(res.length).toBe(12);
  });

  it("an invalid Exa key surfaces as an error, not an empty list", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    await expect(searchProducts("pokemon")).rejects.toThrow("Exa web search failed: Invalid API key");
  });

  it("an invalid Claude key surfaces as an error, not an empty list", async () => {
    installWeb(pokemonWeb());
    llm.mockRejectedValue(new Error(CLAUDE_KEY_ERROR));
    await expect(searchProducts("pokemon")).rejects.toThrow(CLAUDE_KEY_ERROR);
  });

  it("reads and lists one Amazon product once when Exa returns it under two URL forms", async () => {
    const a = "https://www.amazon.com/dp/B09XS7JWHH";
    const b = "https://www.amazon.com/Sony-WH-1000XM5-Canceling-Headphones/dp/B09XS7JWHH?th=1";
    installWeb({
      hits: { "amazon.com": [a, b] },
      pages: [productPage(a, "Sony WH-1000XM5 Headphones, Black", "248.00"), productPage(b, "Sony WH-1000XM5 Headphones, Black", "248.00")],
    });
    const res = await searchProducts("sony wh-1000xm5");
    expect(fetchedUrls()).toHaveLength(1);
    expect(res).toHaveLength(1);
  });

  it("returns [] (no error) when the stores simply have no product pages", async () => {
    installWeb({ hits: { "amazon.com": ["https://www.amazon.com/s?k=zzzz"] }, pages: [] });
    expect(await searchProducts("zzzz")).toEqual([]);
    expect(exa.getContents).not.toHaveBeenCalled();
  });

  it("returns [] (no error) when pages were read but none matched", async () => {
    installWeb(pokemonWeb());
    llm.mockImplementation(async (_n, _s, _sys, user) => ({ ...fakeExtraction(user), matchesQuery: false }));
    expect(await searchProducts("pokemon")).toEqual([]);
  });

  it("skips a page whose extraction failed when the vendor's other pages worked", async () => {
    const web = pokemonWeb();
    installWeb(web);
    llm.mockImplementation(async (_n, _s, _sys, user) => {
      if (user.includes(web.amazonProducts[0])) throw new Error("Claude API error 500");
      return fakeExtraction(user);
    });
    const res = await searchProducts("pokemon");
    expect(res.filter((p) => p.vendor === "amazon")).toHaveLength(5);
  });
});

// ---------- dropImplausible (incident 3) ----------

describe("dropImplausible", () => {
  it("drops ear pads sold as 'Sony WH-1000XM5' at $14.95 among $159.99-$298 XM5 listings", () => {
    const junk = product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black", price: 14.95 });
    const real = [
      product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black (Renewed)", price: 159.99 }),
      product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Silver", price: 228 }),
      product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones, Black", price: 248, vendor: "amazon" }),
      product({ title: "Sony - WH-1000XM5 Wireless Noise Canceling Headphones - Black", price: 298, vendor: "bestbuy" }),
    ];
    expect(dropImplausible([junk, ...real])).toEqual(real);
  });

  it("keeps everything in a broad set with no near-identical twins", () => {
    const broad = [
      product({ title: "Pokemon TCG Charizard ex 223/197 Obsidian Flames Card", price: 5 }),
      product({ title: "Pokemon Deluxe Essential Handbook (Book)", price: 22, vendor: "walmart" }),
      product({ title: "Pokemon Scarlet - Nintendo Switch", price: 114.99, vendor: "bestbuy" }),
    ];
    expect(dropImplausible(broad)).toEqual(broad);
  });

  it("drops a $119.99 LEGO 75192 among $849.95-$1289.99 listings", () => {
    const cheap = product({ title: "LEGO Star Wars Millennium Falcon 75192 Ultimate Collector Series", price: 119.99 });
    const real = [
      product({ title: "LEGO Star Wars Ultimate Collector Series Millennium Falcon 75192", price: 849.95, vendor: "amazon" }),
      product({ title: "LEGO Star Wars Millennium Falcon 75192 Ultimate Collector Series Building Set", price: 959.99, vendor: "walmart" }),
      product({ title: "LEGO 75192 Star Wars Millennium Falcon Ultimate Collector Series", price: 999, vendor: "target" }),
      product({ title: "LEGO Star Wars UCS Millennium Falcon 75192 Ultimate Collector Series - New Sealed", price: 1289.99 }),
    ];
    expect(dropImplausible([cheap, ...real])).toEqual(real);
  });

  it("keeps a cheap item that has fewer than 3 near-identical listings", () => {
    const set = [
      product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black", price: 14.95 }),
      product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Silver", price: 228 }),
      product({ title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones, Black", price: 248 }),
    ];
    expect(dropImplausible(set)).toEqual(set);
  });

  it("keeps a price at or above 40% of the similar listings' median", () => {
    const set = [
      product({ title: "Nintendo Switch OLED Model White", price: 120 }),
      product({ title: "Nintendo Switch OLED Model White Console", price: 300 }),
      product({ title: "Nintendo Switch OLED Model - White", price: 300 }),
      product({ title: "Nintendo Switch OLED Model White Joy-Con", price: 300 }),
    ];
    expect(dropImplausible(set)).toEqual(set);
  });

  it("titleTokens ignores case, accents, punctuation and stop words", () => {
    expect(titleTokens("Pokémon: The NEW Scarlet & Violet (Renewed)")).toEqual(new Set(["pokemon", "scarlet", "violet"]));
  });
});

// ---------- filters (incident 6) ----------

describe("filterProducts / applyFilter", () => {
  const results = [
    product({ title: "Sony WH-1000XM4 Headphones Black", price: 148, vendor: "amazon", condition: "used" }),
    product({ title: "Sony WH-1000XM5 Headphones Black", price: 159.99, vendor: "ebay", condition: "refurbished" }),
    product({ title: "Sony WH-1000XM5 Headphones Silver", price: 228, vendor: "bestbuy", condition: "new" }),
    product({ title: "Sony WH-1000XM5 Headphones Black", price: 248, vendor: "amazon", condition: "new" }),
    product({ title: "Sony WH-1000XM5 Headphones Black", price: 298, vendor: "bestbuy", condition: "new" }),
  ];
  const spec = (s: Partial<FilterSpec>): FilterSpec => ({ maxPrice: null, minPrice: null, vendors: [], conditions: [], exclude: [], ...s });

  it("runs the filter agent once, with numbered results, and applies its spec in code", async () => {
    llm.mockResolvedValueOnce(spec({ maxPrice: 250, conditions: ["new"], vendors: ["amazon", "bestbuy"], exclude: [2] }));
    const res = await filterProducts("new only, under $250, from Best Buy or Amazon, black", results);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0][0]).toBe("filter_spec");
    const prompt = llm.mock.calls[0][3];
    expect(prompt).toContain("Refinement: new only, under $250, from Best Buy or Amazon, black");
    expect(prompt).toContain("0. Sony WH-1000XM4 Headphones Black | $148.00 | amazon | used");
    expect(prompt).toContain("4. Sony WH-1000XM5 Headphones Black | $298.00 | bestbuy | new");
    expect(res?.products).toEqual([results[3]]);
    expect(res?.spec.maxPrice).toBe(250);
  });

  it("enforces hard constraints even when the model doesn't exclude anything", () => {
    expect(applyFilter(results, spec({ maxPrice: 230 }))).toEqual(results.slice(0, 3));
    expect(applyFilter(results, spec({ minPrice: 200 }))).toEqual(results.slice(2));
    expect(applyFilter(results, spec({ vendors: ["bestbuy"] }))).toEqual([results[2], results[4]]);
    expect(applyFilter(results, spec({ conditions: ["used", "refurbished"] }))).toEqual(results.slice(0, 2));
  });

  it("excludes the given indices and preserves order (cheapest first)", () => {
    const out = applyFilter(results, spec({ exclude: [0, 3] }));
    expect(out).toEqual([results[1], results[2], results[4]]);
  });

  it("empty vendor/condition lists mean 'all'", () => {
    expect(applyFilter(results, spec({}))).toEqual(results);
  });

  it("returns null when the model can't produce a spec", async () => {
    llm.mockResolvedValueOnce(null);
    expect(await filterProducts("something", results)).toBeNull();
  });

  it("surfaces an invalid Claude key as an error", async () => {
    llm.mockRejectedValueOnce(new Error(CLAUDE_KEY_ERROR));
    await expect(filterProducts("under $200", results)).rejects.toThrow(CLAUDE_KEY_ERROR);
  });
});
