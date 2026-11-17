import { describe, expect, it } from "vitest";
import { containsAmount, dropRepeats, priceIsGrounded } from "@/lib/products";
import { productKey, RESALE_MARKETS, SHOP_VENDORS, siteOf, uniqueProductUrls } from "@/lib/vendors";
import { product } from "./helpers/data";

const vendor = (id: string) => [...SHOP_VENDORS, ...RESALE_MARKETS].find((v) => v.id === id)!;

describe("siteOf", () => {
  it.each([
    ["daily.slickdeals.net", "slickdeals.net"],
    ["slickdeals.net", "slickdeals.net"],
    ["www.retailmenot.com", "retailmenot.com"],
    ["deals.target.com", "target.com"],
    ["shop.example.co.uk", "example.co.uk"],
    ["example.co.uk", "example.co.uk"],
    ["coupons.example.com.au", "example.com.au"],
    ["localhost", "localhost"],
  ])("%s -> %s", (host, site) => {
    expect(siteOf(host)).toBe(site);
  });
});

describe("productKey / uniqueProductUrls", () => {
  it("gives one Amazon product one key across slug, /dp/, /gp/product/ and query forms", () => {
    const forms = [
      "https://www.amazon.com/dp/B09XS7JWHH",
      "https://www.amazon.com/Sony-WH-1000XM5-Canceling-Headphones/dp/B09XS7JWHH?th=1",
      "https://amazon.com/gp/product/b09xs7jwhh/ref=ox_sc_act_title_1",
      "https://www.amazon.com/dp/B09XS7JWHH#customerReviews",
    ];
    expect(new Set(forms.map(productKey)).size).toBe(1);
    expect(productKey(forms[0])).not.toBe(productKey("https://www.amazon.com/dp/B0BX2L8PBT"));
  });

  it("gives one eBay item one key regardless of slug or tracking, but keeps variations apart", () => {
    const a = "https://www.ebay.com/itm/366644194289";
    const b = "https://www.ebay.com/itm/Nintendo-Switch-Lite/366644194289?_trkparms=itmf%3D1&itmmeta=01M1";
    expect(productKey(a)).toBe(productKey(b));
    expect(productKey(`${a}?var=111`)).not.toBe(productKey(`${a}?var=222`));
    expect(productKey(`${a}?var=111`)).not.toBe(productKey(a));
  });

  it("keeps query strings that select a variant on other stores (Target ?preselect=)", () => {
    const base = "https://www.target.com/p/stanley-quencher/-/A-88843765";
    expect(productKey(`${base}?preselect=88843789`)).not.toBe(productKey(`${base}?preselect=88843800`));
    expect(productKey(`${base}#lnk=sametab`)).toBe(productKey(base));
  });

  it("filters to the vendor's product pages, drops duplicates, keeps order, strips eBay tracking", () => {
    const ebay = vendor("ebay");
    const urls = [
      "https://www.ebay.com/sch/i.html?_nkw=switch+lite", // search page
      "https://www.ebay.com/itm/266830629477?chn=ps&google_free_listing_action=view_item",
      "https://www.amazon.com/dp/B09XS7JWHH", // other vendor
      "https://www.ebay.com/itm/266830629477",
      "https://www.ebay.com/itm/405655583511?var=7&_trksid=p2332490",
    ];
    expect(uniqueProductUrls(urls, ebay)).toEqual([
      "https://www.ebay.com/itm/266830629477",
      "https://www.ebay.com/itm/405655583511?var=7",
    ]);
  });

  it("leaves non-eBay URLs as found (minus the #fragment), so variant parameters still reach the page", () => {
    const target = vendor("target");
    const u = "https://www.target.com/p/stanley-quencher/-/A-88843765?preselect=88843789";
    expect(uniqueProductUrls([`${u}#lnk=sametab`], target)).toEqual([u]);
  });

  it("returns [] for no URLs and ignores unparseable ones", () => {
    expect(uniqueProductUrls([], vendor("amazon"))).toEqual([]);
    expect(uniqueProductUrls(["not a url", "https://www.amazon.com/dp/B09XS7JWHH"], vendor("amazon"))).toEqual([
      "https://www.amazon.com/dp/B09XS7JWHH",
    ]);
  });
});

describe("containsAmount", () => {
  it.each([
    ["Price: $149.99", "$149.99", true],
    ["Price: $149.99.", "$149.99", true], // sentence-ending period
    ["$24.62 ($0.51/Ounce)", "$24.62", true],
    ["US $144.58", "US $144.58", true],
    ["Price: $149.99", "$14", false],
    ["Price: $149.99", "$149", false],
    ["Now $1,299.00", "$1", false],
    ["Now $1,299.00", "$1,299", false],
    ["Now $1,299.00", "$1,299.00", true],
    ["Was 149.99", "49.99", false],
    ["Was 149.99 now 49.99", "49.99", true], // a later whole occurrence counts
    ["anything", "", false],
  ])("%j contains %j: %s", (text, quote, expected) => {
    expect(containsAmount(text, quote)).toBe(expected);
  });

  it("is what priceIsGrounded uses, after normalizing spaces", () => {
    expect(priceIsGrounded("Price:\n$149.99", "$149.99", 149.99)).toBe(true);
    expect(priceIsGrounded("Price: $1,299.00", "$1", 1)).toBe(false);
    expect(priceIsGrounded("Price: $1,299.00", "$1,299.00", 1299)).toBe(true);
  });
});

describe("dropRepeats", () => {
  it("collapses identical store + title + price rows (one parent listed under several ASINs)", () => {
    const title = "ALTOIDS Arctic Peppermint Breath Mints Hard Candy Bulk, 1.2 oz Tin (Pack of 8)";
    const rows = ["B00N9TAZHW", "B019Z9O2IC", "B01E9I351O"].map((asin) =>
      product({ id: asin, url: `https://www.amazon.com/dp/${asin}`, title, price: 24.62, vendor: "amazon", vendorName: "Amazon" }),
    );
    const out = dropRepeats(rows);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://www.amazon.com/dp/B00N9TAZHW");
  });

  it("treats case and spacing differences in the title as the same row", () => {
    const a = product({ id: "a", title: "Altoids  Arctic Peppermint", price: 24.62, vendor: "amazon" });
    const b = product({ id: "b", title: "altoids arctic peppermint", price: 24.62, vendor: "amazon" });
    expect(dropRepeats([a, b])).toEqual([a]);
  });

  it("keeps the same product at another store, at another price, or with another title", () => {
    const base = { title: "Altoids Arctic Peppermint (Pack of 8)", price: 24.62 };
    const rows = [
      product({ id: "1", ...base, vendor: "amazon" }),
      product({ id: "2", ...base, vendor: "walmart" }),
      product({ id: "3", ...base, vendor: "amazon", price: 24.64 }),
      product({ id: "4", ...base, vendor: "amazon", title: "Altoids Arctic Peppermint (Pack of 12)" }),
    ];
    expect(dropRepeats(rows)).toHaveLength(4);
  });
});
