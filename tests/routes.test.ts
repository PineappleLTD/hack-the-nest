// Route handlers, end to end: real src/lib code, fake Exa, fake Claude (answers by system prompt),
// mocked cookies, and a fake Stripe for the payment routes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as SDK from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { POST as searchPOST } from "@/app/api/search/route";
import { POST as filterPOST } from "@/app/api/filter/route";
import { GET as dealsGET, POST as dealsPOST } from "@/app/api/deals/route";
import { POST as ebayListPOST } from "@/app/api/ebay/list/route";
import { POST as paymentLinkPOST } from "@/app/api/payment-link/route";
import { GET as connectStartGET } from "@/app/api/stripe/connect/start/route";
import { DELETE as connectDELETE, GET as connectGET } from "@/app/api/stripe/connect/route";
import { POST as priceCheckPOST } from "@/app/api/price-check/route";
import { anthropic, authError, type ParseParams } from "./helpers/anthropic-mock";
import { exa, exaError } from "./helpers/exa-mock";
import { insertDeal, product } from "./helpers/data";
import { fakeExtraction, installWeb, productPage } from "./helpers/web";

const cookieJar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => {
      store.set(name, value);
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const SELLER_COOKIE = "agentshop_seller";
const ORIGIN = "http://localhost:3000";

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

type ClaudeAnswers = { filterSpec?: unknown; deals?: unknown; copy?: unknown };
let answers: ClaudeAnswers = {};
/** Which system prompts Claude was called with, by their first line. */
const promptKinds = () => anthropic.parse.mock.calls.map(([p]) => p.system.split("\n")[0]);

beforeEach(() => {
  answers = {};
  cookieJar.store.clear();
  anthropic.parse.mockImplementation(async (p: ParseParams) => {
    const user = p.messages[0].content;
    const done = (parsed: unknown) => ({ stop_reason: "end_turn", parsed_output: parsed });
    if (p.system.startsWith("You extract product listing data")) return done(fakeExtraction(user));
    if (p.system.startsWith("You apply a shopper's plain-English refinement")) return done(answers.filterSpec ?? null);
    if (p.system.startsWith("You extract coupon codes")) return done(answers.deals ?? { deals: [] });
    if (p.system.startsWith("You write resale listings")) return done(answers.copy ?? null);
    throw new Error(`unexpected prompt: ${p.system.slice(0, 40)}`);
  });
});

// ---------- /api/search ----------

describe("POST /api/search", () => {
  const pages = [
    productPage("https://www.amazon.com/Sony-WH-1000XM5/dp/B09XS7JWHH", "Sony WH-1000XM5 Headphones Black", "248.00"),
    productPage("https://www.bestbuy.com/site/sony-wh1000xm5/6505727.p?skuId=6505727", "Sony WH-1000XM5 Headphones Black", "298.00"),
    productPage("https://www.ebay.com/itm/266000000002", "Sony WH-1000XM5 Headphones Black Renewed", "159.99"),
  ];
  const hits = { "amazon.com": [pages[0].url], "bestbuy.com": [pages[1].url], "ebay.com": [pages[2].url] };

  it("400s without a query", async () => {
    const res = await searchPOST(post("/api/search", { query: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "query is required" });
    expect((await searchPOST(post("/api/search", "not json"))).status).toBe(400);
  });

  it("returns grounded products cheapest first, plus deal counts", async () => {
    installWeb({ hits, pages });
    insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code: "SAVE10", discount_text: "$10 off $50+", source_url: "https://www.bestbuy.com/deals", scope: "sitewide" });
    const res = await searchPOST(post("/api/search", { query: "sony wh-1000xm5" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.query).toBe("sony wh-1000xm5");
    expect(json.products.map((p: { price: number }) => p.price)).toEqual([159.99, 248, 298]);
    expect(json.products[0].url).toBe(pages[2].url);
    expect(json.dealCounts).toEqual({ bestbuy: 1 });
  });

  it("never runs the filter agent for a plain search", async () => {
    installWeb({ hits, pages });
    await searchPOST(post("/api/search", { query: "sony wh-1000xm5" }));
    expect(anthropic.parse).toHaveBeenCalledTimes(3);
    expect(new Set(promptKinds())).toEqual(new Set(["You extract product listing data from the text of a single web page."]));
  });

  it("an invalid Claude key is a 500 with a readable message, not empty results", async () => {
    installWeb({ hits, pages });
    anthropic.parse.mockRejectedValue(authError(SDK));
    const res = await searchPOST(post("/api/search", { query: "sony wh-1000xm5" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Claude rejected the API key (check ANTHROPIC_API_KEY)" });
  });

  it("an invalid Exa key is a 500 with a readable message", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    const res = await searchPOST(post("/api/search", { query: "sony wh-1000xm5" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Exa web search failed: Invalid API key");
  });

  const events = async (res: Response) =>
    (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

  it("with stream: true, sends each product as it's found, then the final list", async () => {
    installWeb({ hits, pages });
    insertDeal(db, { store: "Best Buy", store_key: "bestbuy", code: "SAVE10", discount_text: "$10 off $50+", source_url: "https://www.bestbuy.com/deals", scope: "sitewide" });
    const res = await searchPOST(post("/api/search", { query: "sony wh-1000xm5", stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const all = await events(res);
    expect(all.filter((e) => e.type === "product")).toHaveLength(3);
    const done = all.at(-1);
    expect(done.type).toBe("done");
    expect(done.products.map((p: { price: number }) => p.price)).toEqual([159.99, 248, 298]);
    expect(done.dealCounts).toEqual({ bestbuy: 1 });
  });

  it("with stream: true, a failed search ends with a readable error event", async () => {
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    const res = await searchPOST(post("/api/search", { query: "sony wh-1000xm5", stream: true }));
    expect(await events(res)).toEqual([{ type: "error", error: "Exa web search failed: Invalid API key" }]);
  });
});

// ---------- /api/filter ----------

describe("POST /api/filter", () => {
  const products = [
    product({ title: "Sony WH-1000XM5 Black Renewed", price: 159.99, vendor: "ebay", condition: "refurbished" }),
    product({ title: "Sony WH-1000XM5 Black", price: 248, vendor: "amazon" }),
    product({ title: "Sony WH-1000XM5 Silver", price: 278, vendor: "amazon" }),
    product({ title: "Sony WH-1000XM5 Black", price: 298, vendor: "bestbuy" }),
  ];

  it("400s without text", async () => {
    expect((await filterPOST(post("/api/filter", { products }))).status).toBe(400);
  });

  it("returns no products without calling Claude when there's nothing to filter", async () => {
    const res = await filterPOST(post("/api/filter", { text: "new only", products: [] }));
    expect(await res.json()).toEqual({ spec: null, products: [] });
    expect(anthropic.parse).not.toHaveBeenCalled();
  });

  it("applies the spec in code and preserves order", async () => {
    answers.filterSpec = { maxPrice: 280, minPrice: null, vendors: ["amazon", "bestbuy"], conditions: ["new"], exclude: [2] };
    const res = await filterPOST(post("/api/filter", { text: "new, under $280, Amazon or Best Buy, black", products }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products.map((p: { price: number }) => p.price)).toEqual([248]);
    expect(promptKinds()).toEqual(["You apply a shopper's plain-English refinement to a numbered list of search results."]);
  });

  it("422s when Claude can't produce a spec", async () => {
    answers.filterSpec = null;
    const res = await filterPOST(post("/api/filter", { text: "???", products }));
    expect(res.status).toBe(422);
  });

  it("an invalid Claude key is a 500 with a readable message", async () => {
    anthropic.parse.mockRejectedValue(authError(SDK));
    const res = await filterPOST(post("/api/filter", { text: "under $200", products }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Claude rejected the API key (check ANTHROPIC_API_KEY)");
  });
});

// ---------- /api/deals ----------

describe("/api/deals", () => {
  const target20 = {
    store: "Target",
    store_key: "target",
    code: "TARGET20",
    discount_text: "20% off sitewide",
    source_url: "https://www.target.com/circle/deals",
    scope: "sitewide",
    percent_off: 20,
  };

  it("GET 400s without a store and normalizes the store name", async () => {
    expect((await dealsGET(new Request(`${ORIGIN}/api/deals`))).status).toBe(400);
    insertDeal(db, { ...target20, store: "Best Buy", store_key: "bestbuy", code: "SAVE10", source_url: "https://www.bestbuy.com/d" });
    const res = await dealsGET(new Request(`${ORIGIN}/api/deals?store=Best%20Buy`));
    expect((await res.json()).deals.map((d: { code: string }) => d.code)).toEqual(["SAVE10"]);
  });

  it("POST {stores}: a failed lookup falls back to stored deals; unknown stores are ignored", async () => {
    insertDeal(db, target20);
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    const res = await dealsPOST(post("/api/deals", { stores: ["target", "walmart", "target", "costco", 42] }));
    expect(res.status).toBe(200);
    const { deals } = await res.json();
    expect(Object.keys(deals).sort()).toEqual(["target", "walmart"]);
    expect(deals.target.map((d: { code: string }) => d.code)).toEqual(["TARGET20"]);
    expect(deals.walmart).toEqual([]);
    // One lookup per unique known store (two Exa searches each).
    expect(exa.search).toHaveBeenCalledTimes(4);
  });

  it("POST {stores}: returns only verifiable store-wide deals found by the lookup", async () => {
    const url = "https://www.retailmenot.com/view/walmart.com";
    exa.search.mockResolvedValue({ results: [{ id: url, url, title: "Walmart coupons", text: "Walmart promo code RPM: 15% off sitewide. Code WM10 for $10 off $50 on toys." }] });
    answers.deals = {
      deals: [
        { store: "Walmart", code: "RPM", description: "15% off sitewide", discountText: "15% off sitewide", expiresAt: null, scope: "sitewide", appliesTo: "any order", percentOff: 15, amountOff: null, minSpend: null, maxSavings: null },
      ],
    };
    const { deals } = await (await dealsPOST(post("/api/deals", { stores: ["walmart"] }))).json();
    // Found and stored, but a single coupon site isn't enough to show it.
    expect(deals.walmart).toEqual([]);
    expect(db.prepare("SELECT code FROM deals").all()).toEqual([{ code: "RPM" }]);
  });

  it("POST {query} returns found deals, and a 500 when the lookup fails", async () => {
    const url = "https://www.bestbuy.com/site/misc/deals";
    exa.search.mockResolvedValue({ results: [{ id: url, url, title: "Best Buy deals", text: "Use code SAVE10 for $10 off $50 or more." }] });
    answers.deals = {
      deals: [{ store: "Best Buy", code: "SAVE10", description: "$10 off $50+", discountText: "$10 off $50+", expiresAt: null, scope: "sitewide", appliesTo: "any order", percentOff: null, amountOff: 10, minSpend: 50, maxSavings: null }],
    };
    const ok = await (await dealsPOST(post("/api/deals", { query: "Best Buy" }))).json();
    expect(ok.deals.map((d: { code: string }) => d.code)).toEqual(["SAVE10"]);

    db.exec("DELETE FROM cache");
    exa.search.mockRejectedValue(exaError(401, "Invalid API key"));
    const res = await dealsPOST(post("/api/deals", { query: "Best Buy" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Exa web search failed: Invalid API key");
  });

  it("POST without query or stores is a 400", async () => {
    expect((await dealsPOST(post("/api/deals", {}))).status).toBe(400);
  });
});

// ---------- /api/ebay/list ----------

describe("POST /api/ebay/list", () => {
  const listing = {
    title: "Nintendo Switch OLED Model White 64GB",
    description: "- Works great",
    price: 236.99,
    condition: "Good",
    imageUrls: ["https://i.imgur.com/switch.jpg"],
  };

  it("400s without title, description and a positive price", async () => {
    expect((await ebayListPOST(post("/api/ebay/list", { ...listing, price: 0 }))).status).toBe(400);
    expect((await ebayListPOST(post("/api/ebay/list", { ...listing, title: "" }))).status).toBe(400);
  });

  it("503s with a clear message when EBAY_OAUTH_TOKEN is unset", async () => {
    const res = await ebayListPOST(post("/api/ebay/list", listing));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/EBAY_OAUTH_TOKEN/);
  });

  it("400s when there's no public https photo", async () => {
    vi.stubEnv("EBAY_OAUTH_TOKEN", "fake-ebay-token");
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    for (const imageUrls of [[], ["/uploads/abc.jpg"], ["http://example.com/a.jpg"], undefined]) {
      const res = await ebayListPOST(post("/api/ebay/list", { ...listing, imageUrls }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/https photo/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------- Stripe ----------

type StripeCall = { url: string; method: string; headers: Record<string, string>; body: URLSearchParams };

function fakeStripe(responses: Record<string, unknown>) {
  const calls: StripeCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: init.headers as Record<string, string>,
        body: new URLSearchParams(init.body ? String(init.body) : ""),
      });
      const path = url.replace("https://api.stripe.com/v1", "");
      const key = Object.keys(responses).find((k) => path === k || path.startsWith(k));
      if (!key) return new Response(JSON.stringify({ error: { message: `no fake for ${path}` } }), { status: 404 });
      return new Response(JSON.stringify(responses[key]), { status: 200 });
    }),
  );
  return calls;
}

describe("POST /api/payment-link", () => {
  it("400s without a name and a positive price", async () => {
    expect((await paymentLinkPOST(post("/api/payment-link", { name: "Switch", price: 0 }))).status).toBe(400);
  });

  it("503s when Stripe isn't configured", async () => {
    const res = await paymentLinkPOST(post("/api/payment-link", { name: "Nintendo Switch OLED", price: 236.99 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/STRIPE_SECRET_KEY/);
  });

  it("409s when this browser hasn't connected a Stripe account", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const res = await paymentLinkPOST(post("/api/payment-link", { name: "Nintendo Switch OLED", price: 236.99 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Connect your Stripe account/);
  });

  it("creates the link on the seller's connected account, priced in cents", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    cookieJar.set(SELLER_COOKIE, "seller-1");
    db.prepare("INSERT INTO stripe_accounts (seller_id, account_id, created_at) VALUES ('seller-1', 'acct_123', 0)").run();
    const calls = fakeStripe({ "/prices": { id: "price_1" }, "/payment_links": { url: "https://buy.stripe.com/test_abc" } });
    const res = await paymentLinkPOST(post("/api/payment-link", { name: "Nintendo Switch OLED", price: 236.99 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://buy.stripe.com/test_abc" });
    expect(calls.map((c) => c.headers["Stripe-Account"])).toEqual(["acct_123", "acct_123"]);
    expect(calls[0].body.get("unit_amount")).toBe("23699");
    expect(calls[0].body.get("currency")).toBe("usd");
    expect(calls[1].body.get("line_items[0][price]")).toBe("price_1");
  });
});

describe("/api/stripe/connect", () => {
  it("start redirects (303) to /?stripe=error&message=... when Stripe isn't configured", async () => {
    const res = await connectStartGET(new Request(`${ORIGIN}/api/stripe/connect/start`));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("stripe")).toBe("error");
    expect(location.searchParams.get("message")).toMatch(/Stripe isn't set up/);
  });

  it("start creates an account for a new seller and redirects to Stripe onboarding", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const calls = fakeStripe({ "/accounts": { id: "acct_new" }, "/account_links": { url: "https://connect.stripe.com/setup/s/abc" } });
    const res = await connectStartGET(new Request(`${ORIGIN}/api/stripe/connect/start`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://connect.stripe.com/setup/s/abc");
    const seller = cookieJar.store.get(SELLER_COOKIE)!;
    expect(seller).toBeTruthy();
    expect(db.prepare("SELECT account_id FROM stripe_accounts WHERE seller_id = ?").get(seller)).toEqual({ account_id: "acct_new" });
    expect(calls[1].body.get("return_url")).toBe(`${ORIGIN}/?stripe=return`);
    expect(calls[1].body.get("refresh_url")).toBe(`${ORIGIN}/api/stripe/connect/start`);
  });

  it("start redirects to the error page when Stripe rejects the request", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    fakeStripe({});
    const res = await connectStartGET(new Request(`${ORIGIN}/api/stripe/connect/start`));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).searchParams.get("message")).toMatch(/^Stripe: /);
  });

  it("GET reports unconfigured / not connected / connected", async () => {
    expect(await (await connectGET()).json()).toEqual({ configured: false, connected: false, chargesEnabled: false, detailsSubmitted: false, accountName: null });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    expect((await (await connectGET()).json()).connected).toBe(false);
    cookieJar.set(SELLER_COOKIE, "seller-2");
    db.prepare("INSERT INTO stripe_accounts (seller_id, account_id, created_at) VALUES ('seller-2', 'acct_2', 0)").run();
    fakeStripe({ "/accounts/acct_2": { charges_enabled: true, details_submitted: true, business_profile: { name: "Mike's Games" } } });
    expect(await (await connectGET()).json()).toEqual({ configured: true, connected: true, chargesEnabled: true, detailsSubmitted: true, accountName: "Mike's Games" });
  });

  it("DELETE forgets this browser's account", async () => {
    cookieJar.set(SELLER_COOKIE, "seller-3");
    db.prepare("INSERT INTO stripe_accounts (seller_id, account_id, created_at) VALUES ('seller-3', 'acct_3', 0)").run();
    expect(await (await connectDELETE()).json()).toEqual({ connected: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM stripe_accounts").get()).toEqual({ n: 0 });
  });
});

// ---------- /api/price-check ----------

describe("POST /api/price-check", () => {
  it("400s without an item or with a bad body", async () => {
    expect((await priceCheckPOST(post("/api/price-check", { item: " " }))).status).toBe(400);
    expect((await priceCheckPOST(post("/api/price-check", "{nope"))).status).toBe(400);
  });

  it("leaves the condition out unless the seller picked one, and returns the report", async () => {
    const ebay = productPage("https://www.ebay.com/itm/387000000002", "Nintendo Switch OLED White Pre-Owned", "245.00");
    installWeb({ hits: { "ebay.com": [ebay.url] }, pages: [ebay] });
    const res = await priceCheckPOST(post("/api/price-check", { item: "Nintendo Switch OLED" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.input.condition).toBeUndefined();
    expect(json.photoUrl).toBeNull();
    expect(json.markets.map((m: { market: string }) => m.market)).toEqual(["ebay", "mercari", "facebook"]);
    expect(json.markets[2]).toMatchObject({ estimatedFrom: ["eBay"], recommended: 236.99 });
    // No copy from Claude (null) -> fallback copy, and the condition picker stays available.
    expect(json.markets[0].title).toBe("Nintendo Switch OLED");
    expect(json.conditionApplies).toBe(true);
    expect(exa.search).toHaveBeenCalledWith("Nintendo Switch OLED listing", expect.anything());
  });

  it("accepts multipart form data and ignores a non-image 'photo' (nothing is written)", async () => {
    installWeb({ hits: {}, pages: [] });
    const form = new FormData();
    form.set("item", "Nintendo Switch OLED");
    form.set("condition", "Like New");
    form.set("photo", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const res = await priceCheckPOST(new Request(`${ORIGIN}/api/price-check`, { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.photoUrl).toBeNull();
    expect(json.input.condition).toBe("Like New");
  });

  it("an invalid Claude key is a 500 with a readable message", async () => {
    const ebay = productPage("https://www.ebay.com/itm/387000000002", "Nintendo Switch OLED White Pre-Owned", "245.00");
    installWeb({ hits: { "ebay.com": [ebay.url] }, pages: [ebay] });
    anthropic.parse.mockRejectedValue(authError(SDK));
    const res = await priceCheckPOST(post("/api/price-check", { item: "Nintendo Switch OLED" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Claude rejected the API key (check ANTHROPIC_API_KEY)");
  });
});
