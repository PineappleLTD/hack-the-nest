import { describe, expect, it } from "vitest";
import {
  hostOf,
  isFirstPartySource,
  isProductPage,
  MARKETPLACE_IDS,
  RESALE_MARKETS,
  SHOP_VENDORS,
  storeKey,
  vendorById,
  vendorForUrl,
} from "@/lib/vendors";

const vendor = (id: string) => [...SHOP_VENDORS, ...RESALE_MARKETS].find((v) => v.id === id)!;

describe("vendor lists", () => {
  it("has the six shop vendors and three resale markets", () => {
    expect(SHOP_VENDORS.map((v) => v.id)).toEqual(["amazon", "ebay", "etsy", "bestbuy", "walmart", "target"]);
    expect(RESALE_MARKETS.map((v) => v.id)).toEqual(["ebay", "mercari", "facebook"]);
  });

  it("treats Amazon, eBay and Etsy as marketplaces", () => {
    expect([...MARKETPLACE_IDS].sort()).toEqual(["amazon", "ebay", "etsy"]);
  });
});

// Incident: a broad query returned 2 results because most Exa hits were search/category pages.
describe("isProductPage", () => {
  const productPages: [string, string][] = [
    ["amazon", "https://www.amazon.com/dp/B00N9TAZHW"],
    ["amazon", "https://www.amazon.com/Altoids-Arctic-Peppermint-Mints-Pack/dp/B00N9TAZHW"],
    ["amazon", "https://www.amazon.com/Pokemon-TCG-Scarlet-Violet-Booster/dp/B0C8Y1T6QG?th=1"],
    ["amazon", "https://www.amazon.com/gp/product/B09XS7JWHH"],
    ["ebay", "https://www.ebay.com/itm/256123456789"],
    ["ebay", "https://www.ebay.com/itm/Sony-WH-1000XM5-Wireless-Headphones/256123456789"],
    ["ebay", "https://www.ebay.com/p/16055495618"],
    ["etsy", "https://www.etsy.com/listing/1234567890/pikachu-crochet-plush"],
    ["etsy", "https://www.etsy.com/il-en/listing/1234567890/pikachu-crochet-plush"],
    ["bestbuy", "https://www.bestbuy.com/site/sony-wh1000xm5-wireless-noise-canceling-headphones-black/6505727.p?skuId=6505727"],
    ["bestbuy", "https://www.bestbuy.com/product/sony-wh-1000xm5-wireless-headphones-black/J3ZYG2C5H8"],
    ["walmart", "https://www.walmart.com/ip/Pokemon-Scarlet-Nintendo-Switch/1440395469"],
    ["walmart", "https://www.walmart.com/ip/1440395469"],
    ["target", "https://www.target.com/p/pokemon-scarlet-nintendo-switch/-/A-85343131"],
    ["mercari", "https://www.mercari.com/us/item/m12345678901/"],
    ["facebook", "https://www.facebook.com/marketplace/item/1234567890123456/"],
  ];
  it.each(productPages)("accepts %s product page %s", (id, url) => {
    expect(isProductPage(url, vendor(id))).toBe(true);
  });

  const notProductPages: [string, string][] = [
    ["amazon", "https://www.amazon.com/s?k=pokemon"],
    ["amazon", "https://www.amazon.com/b?node=166220011"],
    ["amazon", "https://www.amazon.com/zgbs/toys-and-games"],
    ["amazon", "https://www.amazon.com/gp/bestsellers/toys-and-games"],
    ["amazon", "https://www.amazon.com/stores/Pokemon/page/0A5C9D2B"],
    ["ebay", "https://www.ebay.com/b/Pokemon-Trading-Card-Game/183454/bn_1"],
    ["ebay", "https://www.ebay.com/sch/i.html?_nkw=pokemon"],
    ["etsy", "https://www.etsy.com/market/pokemon"],
    ["etsy", "https://www.etsy.com/c/toys-and-games"],
    ["etsy", "https://www.etsy.com/shop/PokeCrafts"],
    ["bestbuy", "https://www.bestbuy.com/site/shop/pokemon"],
    ["bestbuy", "https://www.bestbuy.com/site/searchpage.jsp?st=pokemon"],
    ["bestbuy", "https://www.bestbuy.com/site/video-games/nintendo-switch/pcmcat1484077694025.c?id=pcmcat1484077694025"],
    ["walmart", "https://www.walmart.com/browse/toys/pokemon/4171_4191"],
    ["walmart", "https://www.walmart.com/search?q=pokemon"],
    ["walmart", "https://www.walmart.com/cp/pokemon/3089318"],
    ["target", "https://www.target.com/c/pokemon/-/N-5xtz4"],
    ["target", "https://www.target.com/s?searchTerm=pokemon"],
    ["mercari", "https://www.mercari.com/search/?keyword=pokemon"],
    ["facebook", "https://www.facebook.com/marketplace/nyc/search?query=pokemon"],
  ];
  it.each(notProductPages)("rejects %s non-product page %s", (id, url) => {
    expect(isProductPage(url, vendor(id))).toBe(false);
  });

  it("rejects strings that are not URLs", () => {
    expect(isProductPage("not a url /dp/B00N9TAZHW", vendor("amazon"))).toBe(false);
  });
});

describe("vendorForUrl / hostOf", () => {
  it("maps URLs to vendors by domain, including subdomains", () => {
    expect(vendorForUrl("https://www.amazon.com/dp/B00N9TAZHW")?.id).toBe("amazon");
    expect(vendorForUrl("https://smile.amazon.com/dp/B00N9TAZHW")?.id).toBe("amazon");
    expect(vendorForUrl("https://www.bestbuy.com/site/x/6505727.p")?.id).toBe("bestbuy");
    expect(vendorForUrl("https://www.mercari.com/us/item/m123/")?.id).toBe("mercari");
  });

  it("does not match lookalike or foreign domains", () => {
    expect(vendorForUrl("https://amazon.com.evil.example/dp/B00N9TAZHW")).toBeUndefined();
    expect(vendorForUrl("https://notamazon.com/dp/B00N9TAZHW")).toBeUndefined();
    expect(vendorForUrl("https://www.amazon.co.uk/dp/B00N9TAZHW")).toBeUndefined();
    expect(vendorForUrl("garbage")).toBeUndefined();
  });

  it("hostOf lowercases and strips www", () => {
    expect(hostOf("https://WWW.Target.com/p/x")).toBe("target.com");
    expect(hostOf("https://daily.slickdeals.net/x")).toBe("daily.slickdeals.net");
    expect(hostOf("nope")).toBe("");
  });
});

describe("storeKey", () => {
  it.each([
    ["Best Buy", "bestbuy"],
    ["bestbuy.com", "bestbuy"],
    ["https://www.target.com/c/deals", "target"],
    ["Walmart", "walmart"],
    ["Amazon.com", "amazon"],
    ["eBay", "ebay"],
  ])("%s -> %s", (input, key) => {
    expect(storeKey(input)).toBe(key);
  });
});

describe("isFirstPartySource", () => {
  it("is true only for the store's own domain or its subdomains", () => {
    expect(isFirstPartySource("target", "target.com")).toBe(true);
    expect(isFirstPartySource("target", "corporate.target.com")).toBe(true);
    expect(isFirstPartySource("bestbuy", "bestbuy.com")).toBe(true);
    expect(isFirstPartySource("walmart", "daily.slickdeals.net")).toBe(false);
    expect(isFirstPartySource("etsy", "offersnudge.com")).toBe(false);
    expect(isFirstPartySource("target", "nottarget.com")).toBe(false);
    expect(isFirstPartySource("nosuchstore", "nosuchstore.com")).toBe(false);
  });

  it("vendorById finds both shop vendors and resale markets", () => {
    expect(vendorById("walmart")?.name).toBe("Walmart");
    expect(vendorById("facebook")?.name).toBe("Facebook Marketplace");
    expect(vendorById("nope")).toBeUndefined();
  });
});
