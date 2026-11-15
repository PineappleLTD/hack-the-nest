import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { db } from "@/lib/db";
import { dealCountsByVendor, dealsForStore, findDeals, storeWideDeals, type Deal } from "@/lib/deals";
import { bestDeal } from "@/lib/discount";
import { structured } from "@/lib/llm";
import { exa, exaError, type ExaResponse } from "./helpers/exa-mock";
import { insertDeal } from "./helpers/data";

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, structured: vi.fn(), tryStructured: vi.fn(async () => null) };
});

type StructuredFn = (name: string, schema: unknown, system: string, user: string) => Promise<unknown>;
const llm = structured as unknown as Mock<StructuredFn>;

type ModelDeal = {
  store: string;
  code: string | null;
  description: string;
  discountText: string;
  expiresAt: string | null;
  scope: "sitewide" | "category" | "product";
  appliesTo: string;
  percentOff: number | null;
  amountOff: number | null;
  minSpend: number | null;
  maxSavings: number | null;
};
const modelDeal = (d: Partial<ModelDeal> & Pick<ModelDeal, "store" | "discountText">): ModelDeal => ({
  code: null,
  description: d.discountText,
  expiresAt: null,
  scope: "product",
  appliesTo: "",
  percentOff: null,
  amountOff: null,
  minSpend: null,
  maxSavings: null,
  ...d,
});

type Page = { url: string; title: string; text: string };
/** Pages returned for every deal search, and the deals "Claude" finds on each page (by URL). */
let web: Page[] = [];
let dealsByUrl: Record<string, ModelDeal[]> = {};

beforeEach(() => {
  web = [];
  dealsByUrl = {};
  exa.search.mockImplementation(
    async (): Promise<ExaResponse> => ({ results: web.map((p) => ({ id: p.url, url: p.url, title: p.title, text: p.text })) }),
  );
  llm.mockReset();
  llm.mockImplementation(async (name, _schema, _system, user) => {
    if (name !== "deal_extraction") return null;
    const url = /^URL: (.*)$/m.exec(user)?.[1] ?? "";
    return { deals: dealsByUrl[url] ?? [] };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const BESTBUY_URL = "https://www.bestbuy.com/site/misc/deal-of-the-day/pcmcat248000050016.c";
const BESTBUY_TEXT = `Best Buy Deals of the Day
Use code SAVE10 to get $10 off orders of $50 or more. Limit one per customer.
Laptop event: use code LAPTOP15 for 15% off laptops, max savings $40.
Free shipping on orders $35+.
Offer valid through 11/30/2026.`;

function bestBuyPage() {
  web = [{ url: BESTBUY_URL, title: "Deal of the Day | Best Buy", text: BESTBUY_TEXT }];
}

describe("findDeals: extraction grounding", () => {
  it("keeps a deal whose code is on the page, with numbers that appear in its text", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [
      modelDeal({
        store: "Best Buy",
        code: "SAVE10",
        description: "$10 off orders of $50 or more",
        discountText: "$10 off $50+",
        expiresAt: "2026-11-30",
        scope: "sitewide",
        appliesTo: "any order",
        amountOff: 10,
        minSpend: 50,
      }),
    ];
    const [d] = await findDeals("Best Buy");
    expect(d).toMatchObject({
      store: "Best Buy",
      storeKey: "bestbuy",
      code: "SAVE10",
      scope: "sitewide",
      appliesTo: "any order",
      amountOff: 10,
      minSpend: 50,
      percentOff: null,
      maxSavings: null,
      expiresAt: "2026-11-30",
      sourceUrl: BESTBUY_URL,
      sourceHost: "bestbuy.com",
    });
  });

  it("drops percentOff/amountOff that don't appear in the deal's own text", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [
      // The page says 15% (and has "$10" elsewhere); the model claims 25% and $10.
      modelDeal({ store: "Best Buy", code: "LAPTOP15", discountText: "15% off laptops", scope: "category", percentOff: 25, amountOff: 10 }),
    ];
    const [d] = await findDeals("Best Buy");
    expect(d.code).toBe("LAPTOP15");
    expect(d.percentOff).toBeNull();
    expect(d.amountOff).toBeNull();
  });

  it("keeps percentOff when it is in the deal text", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [modelDeal({ store: "Best Buy", code: "LAPTOP15", discountText: "15% off laptops", scope: "category", percentOff: 15 })];
    expect((await findDeals("Best Buy"))[0].percentOff).toBe(15);
  });

  it("checks minSpend/maxSavings against the whole page (fine print)", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [
      modelDeal({ store: "Best Buy", code: "LAPTOP15", discountText: "15% off laptops", scope: "category", percentOff: 15, maxSavings: 40, minSpend: 75 }),
      modelDeal({ store: "Best Buy", code: "SAVE10", discountText: "$10 off", amountOff: 10, maxSavings: 100, minSpend: 50 }),
    ];
    const deals = await findDeals("Best Buy");
    const laptop = deals.find((d) => d.code === "LAPTOP15")!;
    const save10 = deals.find((d) => d.code === "SAVE10")!;
    expect(laptop.maxSavings).toBe(40); // "max savings $40" is on the page
    expect(laptop.minSpend).toBeNull(); // "$75" is not
    expect(save10.minSpend).toBe(50); // "$50 or more" is on the page
    expect(save10.maxSavings).toBeNull(); // "$100" is not
  });

  it("drops a code that isn't on the page, and a no-code deal whose discount text isn't", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [
      modelDeal({ store: "Best Buy", code: "BB25OFF", discountText: "25% off" }),
      modelDeal({ store: "Best Buy", code: null, discountText: "Free 2-day shipping" }),
      modelDeal({ store: "Best Buy", code: null, discountText: "Free shipping on orders $35+" }),
    ];
    const deals = await findDeals("Best Buy");
    expect(deals.map((d) => d.discountText)).toEqual(["Free shipping on orders $35+"]);
  });

  it("matches codes case-insensitively, trims them, and drops unparseable expiry dates", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [modelDeal({ store: "Best Buy", code: "save10 ", discountText: "$10 off", expiresAt: "Nov 30" })];
    const [d] = await findDeals("Best Buy");
    expect(d.code).toBe("save10");
    expect(d.expiresAt).toBeNull();
  });

  it("drops deals with no store or no discount text", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [modelDeal({ store: " ", code: "SAVE10", discountText: "$10 off" }), modelDeal({ store: "Best Buy", code: "SAVE10", discountText: " " })];
    expect(await findDeals("Best Buy")).toEqual([]);
  });

  it("does not ground a minimum of $25 in a page that only says $250 (substring match)", async () => {
    const url = "https://www.target.com/circle/deals/big50";
    web = [{ url, title: "Target deals", text: "Get $50 off orders of $250 or more with code BIG50. Ends 11/30." }];
    dealsByUrl[url] = [
      modelDeal({ store: "Target", code: "BIG50", discountText: "$50 off $250+", scope: "sitewide", amountOff: 50, minSpend: 25 }),
    ];
    const [d] = await findDeals("Target");
    expect(d.amountOff).toBe(50);
    expect(d.minSpend).toBeNull();
  });

  it("still grounds whole amounts written with cents, thousands separators or spaces, and not 20% inside 120%", async () => {
    const url = "https://www.target.com/circle/deals/home";
    web = [
      {
        url,
        title: "Target deals",
        text: "Take $200 off orders of $1,250 or more, up to $ 300 savings, with code HOME200. Also: spend $25.00 for free shipping with code SHIP25. Earn 120% points.",
      },
    ];
    dealsByUrl[url] = [
      modelDeal({ store: "Target", code: "HOME200", discountText: "$200 off $1,250+", scope: "sitewide", amountOff: 200, minSpend: 1250, maxSavings: 300 }),
      modelDeal({ store: "Target", code: "SHIP25", discountText: "free shipping", scope: "sitewide", minSpend: 25, percentOff: 20 }),
    ];
    const deals = await findDeals("Target");
    const a = deals.find((d) => d.code === "HOME200")!;
    const b = deals.find((d) => d.code === "SHIP25")!;
    expect(a).toMatchObject({ amountOff: 200, minSpend: 1250, maxSavings: 300 });
    expect(b.minSpend).toBe(25); // "$25.00" is on the page
    expect(b.percentOff).toBeNull(); // only "120%" is, and percentOff is checked against the deal text anyway
  });
});

describe("findDeals: searches, storage and caching", () => {
  it("runs a dated coupon search and an undated sale search, with page text", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    bestBuyPage();
    await findDeals("Best Buy");
    expect(exa.search).toHaveBeenCalledTimes(2);
    expect(exa.search).toHaveBeenCalledWith("Best Buy promo codes coupons this month", {
      numResults: 8,
      startPublishedDate: "2026-10-01T00:00:00.000Z",
      contents: { text: { maxCharacters: 8000 } },
    });
    expect(exa.search).toHaveBeenCalledWith("Best Buy current sale deals discounts", { numResults: 6, contents: { text: { maxCharacters: 8000 } } });
  });

  it("uses a day-precision startPublishedDate, so a second search the same day hits the cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    bestBuyPage();
    vi.setSystemTime(new Date("2026-11-15T08:00:00.123Z"));
    await findDeals("Best Buy");
    vi.setSystemTime(new Date("2026-11-15T19:30:45.678Z"));
    await findDeals("Best Buy");
    const dated = exa.search.mock.calls.filter(([, o]) => o?.startPublishedDate).map(([, o]) => o!.startPublishedDate);
    expect(dated).toEqual(["2026-10-01T00:00:00.000Z"]);
    expect(exa.search).toHaveBeenCalledTimes(2); // second findDeals served entirely from cache
  });

  it("upserts: re-finding a deal updates found_at and scope instead of adding a row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [modelDeal({ store: "Best Buy", code: "SAVE10", discountText: "$10 off $50+", scope: "category", amountOff: 10 })];
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    await findDeals("Best Buy");
    const first = db.prepare("SELECT id, found_at, scope FROM deals").all() as { id: string; found_at: number; scope: string }[];
    expect(first).toHaveLength(1);

    dealsByUrl[BESTBUY_URL] = [modelDeal({ store: "Best Buy", code: "SAVE10", discountText: "$10 off $50+", scope: "sitewide", amountOff: 10 })];
    vi.setSystemTime(new Date("2026-11-15T09:00:00Z"));
    await findDeals("Best Buy");
    const second = db.prepare("SELECT id, found_at, scope FROM deals").all() as typeof first;
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].scope).toBe("sitewide");
    expect(second[0].found_at).toBe(Date.parse("2026-11-15T09:00:00Z"));
    expect(second[0].found_at).toBeGreaterThan(first[0].found_at);
  });

  it("returns this run's deals plus earlier ones for the same store, and never expired ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code: "OLDCODE", discount_text: "$5 off", source_url: "https://www.bestbuy.com/old", scope: "product", found_at: 1 });
    insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code: "GONE", discount_text: "$5 off", source_url: "https://www.bestbuy.com/gone", scope: "sitewide", expires_at: "2026-11-01" });
    insertDeal(db, { store: "Target", store_key: "target", code: "TGT", discount_text: "$5 off", source_url: "https://www.target.com/x", scope: "sitewide" });
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [
      modelDeal({ store: "Best Buy", code: "SAVE10", discountText: "$10 off", scope: "sitewide", amountOff: 10 }),
      modelDeal({ store: "Best Buy", code: "LAPTOP15", discountText: "15% off laptops", scope: "category", expiresAt: "2026-11-10" }),
    ];
    const codes = (await findDeals("Best Buy")).map((d) => d.code);
    expect(codes).toEqual(["SAVE10", "OLDCODE"]);
  });

  it("works when one of the two searches fails", async () => {
    bestBuyPage();
    dealsByUrl[BESTBUY_URL] = [modelDeal({ store: "Best Buy", code: "SAVE10", discountText: "$10 off" })];
    exa.search.mockRejectedValueOnce(exaError(400, "bad date"));
    expect((await findDeals("Best Buy")).map((d) => d.code)).toEqual(["SAVE10"]);
  });

  it("throws when both searches fail (bad Exa key)", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    await expect(findDeals("Best Buy")).rejects.toThrow("Exa web search failed: Invalid API key");
  });

  it("throws when every page's extraction fails (bad Claude key)", async () => {
    bestBuyPage();
    llm.mockRejectedValue(new Error("Claude rejected the API key (check ANTHROPIC_API_KEY)"));
    await expect(findDeals("Best Buy")).rejects.toThrow("Claude rejected the API key");
  });
});

// ---------- Which stored deals are shown next to results ----------

describe("storeWideDeals", () => {
  it("does not return Walmart RPM listed only on daily.slickdeals.net", () => {
    insertDeal(db, {
      store: "Walmart",
      store_key: "walmart",
      code: "RPM",
      discount_text: "15% off sitewide",
      source_url: "https://daily.slickdeals.net/walmart-coupon-codes",
      scope: "sitewide",
      percent_off: 15,
    });
    expect(storeWideDeals("walmart")).toEqual([]);
  });

  it("does not return Etsy ARTISAN15 from offersnudge.com, even if a second site lists it (marketplace)", () => {
    insertDeal(db, { store: "Etsy", store_key: "etsy", code: "ARTISAN15", discount_text: "15% off sitewide", source_url: "https://offersnudge.com/etsy", scope: "sitewide", percent_off: 15 });
    expect(storeWideDeals("etsy")).toEqual([]);
    insertDeal(db, { store: "Etsy", store_key: "etsy", code: "ARTISAN15", discount_text: "15% off sitewide", source_url: "https://www.couponbirds.com/codes/etsy.com", scope: "sitewide", percent_off: 15 });
    expect(storeWideDeals("etsy")).toEqual([]);
  });

  it("returns a Walmart code listed on two different coupon sites, once", () => {
    insertDeal(db, { store: "Walmart", store_key: "walmart", code: "SAVE20NOW", discount_text: "$20 off $100+", source_url: "https://www.retailmenot.com/view/walmart.com", scope: "sitewide", amount_off: 20, min_spend: 100 });
    insertDeal(db, { store: "Walmart", store_key: "walmart", code: "save20now", discount_text: "$20 off $100", source_url: "https://couponfollow.com/site/walmart.com", scope: "sitewide", amount_off: 20, min_spend: 100 });
    const deals = storeWideDeals("walmart");
    expect(deals).toHaveLength(1);
    expect(deals[0].code?.toUpperCase()).toBe("SAVE20NOW");
  });

  it("returns first-party sitewide and category deals, but not product-scoped or legacy null-scope ones", () => {
    insertDeal(db, { store: "Target", store_key: "target", code: "TARGET20", discount_text: "20% off sitewide", source_url: "https://www.target.com/circle/deals", scope: "sitewide", percent_off: 20 });
    insertDeal(db, { store: "Target", store_key: "target", code: null, discount_text: "Up to 50% off toys", source_url: "https://www.target.com/c/toys-sale", scope: "category" });
    insertDeal(db, { store: "Target", store_key: "target", code: "PUMP40", discount_text: "$40 off", source_url: "https://www.target.com/p/pump/-/A-1", scope: "product" });
    insertDeal(db, { store: "Target", store_key: "target", code: "LEGACY", discount_text: "$5 off", source_url: "https://www.target.com/legacy", scope: null });
    expect(storeWideDeals("target").map((d) => d.discountText)).toEqual(["20% off sitewide", "Up to 50% off toys"]);
  });

  it("never returns Amazon GUN5WP5N (product scope)", () => {
    insertDeal(db, { store: "Amazon", store_key: "amazon", code: "GUN5WP5N", discount_text: "$40 off", description: "$40 off Dual Power Fuel Transfer Pump", source_url: "https://www.amazon.com/promotion/psp/A1B2C3", scope: "product", amount_off: 40 });
    expect(storeWideDeals("amazon")).toEqual([]);
  });

  it("returns a first-party marketplace deal (eBay's own site) but not a coupon-site one", () => {
    insertDeal(db, { store: "eBay", store_key: "ebay", code: "25EXTRAOFF", discount_text: "$25 off sitewide", source_url: "https://www.dealnews.com/ebay", scope: "sitewide", amount_off: 25 });
    insertDeal(db, { store: "eBay", store_key: "ebay", code: null, discount_text: "Up to 60% off refurbished tech", source_url: "https://www.ebay.com/e/fashion/refurb-sale", scope: "category" });
    expect(storeWideDeals("ebay").map((d) => d.sourceHost)).toEqual(["ebay.com"]);
  });

  it("does not treat daily.slickdeals.net and slickdeals.net as two independent sites", () => {
    insertDeal(db, { store: "Walmart", store_key: "walmart", code: "RPM", discount_text: "15% off sitewide", source_url: "https://daily.slickdeals.net/walmart-coupon-codes", scope: "sitewide", percent_off: 15 });
    insertDeal(db, { store: "Walmart", store_key: "walmart", code: "RPM", discount_text: "15% off sitewide", source_url: "https://slickdeals.net/coupons/walmart/", scope: "sitewide", percent_off: 15 });
    expect(storeWideDeals("walmart")).toEqual([]);
  });

  it("when deduping a code, keeps the first-party row so it still applies (Target $50 -> $40)", () => {
    insertDeal(db, { store: "Target", store_key: "target", code: "TARGET20", discount_text: "20% off sitewide", source_url: "https://www.target.com/circle/deals", scope: "sitewide", percent_off: 20, found_at: 1_000 });
    insertDeal(db, { store: "Target", store_key: "target", code: "TARGET20", discount_text: "20% off sitewide", source_url: "https://www.retailmenot.com/view/target.com", scope: "sitewide", percent_off: 20, found_at: 2_000 });
    const deals = storeWideDeals("target");
    expect(deals).toHaveLength(1);
    expect(bestDeal(50, deals)?.price).toBe(40);
  });
});

describe("dealsForStore / dealCountsByVendor", () => {
  it("orders sitewide, then category, then product; codes first; newest first", () => {
    const row = (code: string | null, scope: string, found_at: number) =>
      insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code, discount_text: `${code} ${scope}`, source_url: `https://www.bestbuy.com/${code}-${scope}`, scope, found_at });
    row("P1", "product", 5);
    row(null, "sitewide", 9);
    row("S1", "sitewide", 1);
    row("S2", "sitewide", 2);
    row("C1", "category", 8);
    expect(dealsForStore("bestbuy").map((d: Deal) => d.discountText)).toEqual([
      "S2 sitewide",
      "S1 sitewide",
      "null sitewide",
      "C1 category",
      "P1 product",
    ]);
  });

  it("counts verifiable store-wide deals per shop vendor", () => {
    insertDeal(db, { store: "Target", store_key: "target", code: "TARGET20", discount_text: "20% off", source_url: "https://www.target.com/circle", scope: "sitewide" });
    insertDeal(db, { store: "Walmart", store_key: "walmart", code: "RPM", discount_text: "15% off", source_url: "https://daily.slickdeals.net/w", scope: "sitewide" });
    insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code: "SAVE10", discount_text: "$10 off", source_url: "https://www.bestbuy.com/d", scope: "sitewide" });
    insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code: null, discount_text: "Laptop sale", source_url: "https://www.bestbuy.com/l", scope: "category" });
    expect(dealCountsByVendor()).toEqual({ target: 1, bestbuy: 2 });
  });
});
