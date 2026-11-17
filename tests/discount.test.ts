import { describe, expect, it } from "vitest";
import { applyDeal, bestDeal } from "@/lib/discount";
import { deal } from "./helpers/data";

// Incident 4: bogus deals that once priced items at $0.00 or applied one seller's code store-wide.
describe("applyDeal: deals that must never apply", () => {
  const gun5 = (scope: "product" | null) =>
    deal({
      storeKey: "amazon",
      sourceHost: "amazon.com",
      code: "GUN5WP5N",
      description: "$40 off Dual Power Fuel Transfer Pump",
      discountText: "$40 off",
      scope,
      appliesTo: scope ? "Dual Power Fuel Transfer Pump" : null,
      amountOff: 40,
    });

  it.each([39.99, 40, 89.99, 400])("Amazon GUN5WP5N (product scope) never applies at $%s", (price) => {
    expect(applyDeal(price, gun5("product"))).toBeNull();
  });

  it.each([39.99, 40, 400])("Amazon GUN5WP5N stored before scope was tracked (null) never applies at $%s", (price) => {
    expect(applyDeal(price, gun5(null))).toBeNull();
  });

  it("a marketplace code never applies even when labeled sitewide on the store's own domain", () => {
    expect(applyDeal(400, { ...gun5("product"), scope: "sitewide" })).toBeNull();
  });

  it("eBay 25EXTRAOFF ($25 off sitewide) never applies to a $24.95 item, or any item", () => {
    const d = deal({
      storeKey: "ebay",
      sourceHost: "ebay.com",
      code: "25EXTRAOFF",
      description: "$25 off sitewide",
      discountText: "$25 off sitewide",
      amountOff: 25,
    });
    expect(applyDeal(24.95, d)).toBeNull();
    expect(applyDeal(500, d)).toBeNull();
  });

  it("Walmart RPM (15% off sitewide) from daily.slickdeals.net doesn't apply: not first-party", () => {
    const d = deal({
      storeKey: "walmart",
      sourceHost: "daily.slickdeals.net",
      sourceUrl: "https://daily.slickdeals.net/walmart-promo-code",
      code: "RPM",
      description: "15% off sitewide",
      discountText: "15% off sitewide",
      percentOff: 15,
    });
    expect(applyDeal(100, d)).toBeNull();
  });

  it("Etsy ARTISAN15 from offersnudge.com doesn't apply", () => {
    const d = deal({ storeKey: "etsy", sourceHost: "offersnudge.com", code: "ARTISAN15", discountText: "15% off", percentOff: 15 });
    expect(applyDeal(60, d)).toBeNull();
  });

  it("a 70% sitewide code doesn't apply (more than half off is coupon-site noise)", () => {
    const d = deal({ storeKey: "target", sourceHost: "target.com", code: "TAKE70", discountText: "70% off sitewide", percentOff: 70 });
    expect(applyDeal(50, d)).toBeNull();
  });

  it("a dollars-off code worth more than half the price doesn't apply (never $0.00)", () => {
    const d = deal({ storeKey: "bestbuy", sourceHost: "bestbuy.com", code: "TENOFF", discountText: "$10 off", amountOff: 10 });
    expect(applyDeal(10, d)).toBeNull();
    expect(applyDeal(19.99, d)).toBeNull();
    expect(applyDeal(20, d)?.price).toBe(10);
  });

  it.each([
    ["no code", { code: null }],
    ["category scope", { scope: "category" as const }],
    ["no amount", { percentOff: null, amountOff: null }],
  ])("doesn't apply with %s", (_label, patch) => {
    const d = deal({ storeKey: "target", sourceHost: "target.com", code: "TARGET20", discountText: "20% off", percentOff: 20, ...patch });
    expect(applyDeal(50, d)).toBeNull();
  });

  it.each([
    "Up to 20% off",
    "20% off select items",
    "20% off your first order",
    "20% off for new customers",
    "20% off in the app",
    "20% off for Target Circle members",
    "20% off for students",
    "Extra 20% off clearance",
    "20% off eligible items",
    "20% off, exclusions apply",
    "20% off in-store only",
    "20% off when you subscribe",
    "20% off when you sign up",
  ])("doesn't apply with restrictive fine print: %s", (text) => {
    const d = deal({ storeKey: "target", sourceHost: "target.com", code: "TARGET20", discountText: text, description: text, percentOff: 20 });
    expect(applyDeal(50, d)).toBeNull();
  });

  it("doesn't apply to a non-positive price", () => {
    const d = deal({ storeKey: "target", sourceHost: "target.com", code: "TARGET20", discountText: "20% off", percentOff: 20 });
    expect(applyDeal(0, d)).toBeNull();
    expect(applyDeal(-5, d)).toBeNull();
  });
});

describe("applyDeal: deals that do apply", () => {
  it("Target sitewide 20% code from target.com takes $50 to $40", () => {
    const d = deal({
      storeKey: "target",
      sourceHost: "target.com",
      sourceUrl: "https://www.target.com/circle/deals",
      code: "TARGET20",
      description: "Take 20% off your entire order",
      discountText: "20% off sitewide",
      percentOff: 20,
    });
    expect(applyDeal(50, d)).toEqual({ deal: d, price: 40, saved: 10 });
  });

  it("Best Buy $10 off $50+ from bestbuy.com: not at $40, $50 at $60", () => {
    const d = deal({
      storeKey: "bestbuy",
      sourceHost: "bestbuy.com",
      code: "SAVE10",
      description: "$10 off orders of $50 or more",
      discountText: "$10 off $50+",
      amountOff: 10,
      minSpend: 50,
    });
    expect(applyDeal(40, d)).toBeNull();
    expect(applyDeal(60, d)).toMatchObject({ price: 50, saved: 10 });
    expect(applyDeal(50, d)).toMatchObject({ price: 40, saved: 10 });
  });

  it("a capped '20% off, max $5' takes $100 to $95", () => {
    const d = deal({
      storeKey: "walmart",
      sourceHost: "walmart.com",
      code: "WMT20",
      discountText: "20% off, max $5",
      percentOff: 20,
      maxSavings: 5,
    });
    expect(applyDeal(100, d)).toMatchObject({ price: 95, saved: 5 });
    expect(applyDeal(20, d)).toMatchObject({ price: 16, saved: 4 });
  });

  it("rounds to cents", () => {
    const d = deal({ storeKey: "target", sourceHost: "target.com", code: "T15", discountText: "15% off", percentOff: 15 });
    expect(applyDeal(24.99, d)).toMatchObject({ price: 21.24, saved: 3.75 });
  });

  it("accepts a store subdomain as first-party", () => {
    const d = deal({ storeKey: "target", sourceHost: "corporate.target.com", code: "T10", discountText: "10% off", percentOff: 10 });
    expect(applyDeal(50, d)?.price).toBe(45);
  });
});

describe("bestDeal", () => {
  it("picks the biggest saving among deals that apply", () => {
    const deals = [
      deal({ storeKey: "bestbuy", sourceHost: "bestbuy.com", code: "SAVE10", discountText: "$10 off $50+", amountOff: 10, minSpend: 50 }),
      deal({ storeKey: "bestbuy", sourceHost: "bestbuy.com", code: "PCT15", discountText: "15% off", percentOff: 15 }),
      deal({ storeKey: "bestbuy", sourceHost: "slickdeals.net", code: "BIG40", discountText: "40% off", percentOff: 40 }),
    ];
    expect(bestDeal(60, deals)?.deal.code).toBe("SAVE10");
    expect(bestDeal(100, deals)?.deal.code).toBe("PCT15");
    expect(bestDeal(40, deals)?.deal.code).toBe("PCT15");
  });

  it("returns null when nothing applies", () => {
    expect(bestDeal(50, [])).toBeNull();
    expect(bestDeal(24.95, [deal({ storeKey: "ebay", sourceHost: "ebay.com", code: "25EXTRAOFF", discountText: "$25 off", amountOff: 25 })])).toBeNull();
  });
});
