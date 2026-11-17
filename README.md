# vendr

Shopping without the runaround. Three tools in one web app:

- **Shop**: one search bar. Results come from Amazon, eBay, Etsy, Best Buy, Walmart and Target, sorted lowest price first. A **Filter** box takes plain English ("new only, under $200, from Best Buy or Amazon").
- **Sell**: describe what you're selling. You get comparable listings from eBay, Mercari and Facebook Marketplace, a recommended price for each site, and a listing ready to post.
- **Deals**: coupon codes and sales for any store, each linked to the page it was found on. No affiliate links and no tracking.

## Live link

https://vendr-21lw.onrender.com/

## Trust rules

- **Every price links to a real page.** The model has to quote the exact price text, and we check that text appears on the page. If it doesn't, the result is dropped.
- **Deals are checked the same way.** A code (or the discount text) has to appear on the source page.
- **All LLM output is validated** with Claude structured outputs plus a zod schema. Anything that fails validation is thrown away.
- **Product URLs and vendors come from the page we read**, never from model output.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in keys
npm run dev                  # http://localhost:3000
npm run seed                 # optional: warm the cache with demo queries (app must be running)
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `EXA_API_KEY` | yes | Live web search and page text (Exa) |
| `ANTHROPIC_API_KEY` | yes | Claude: structured extraction, filters, listing copy |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-haiku-5-5` |
| `EBAY_OAUTH_TOKEN` | no | Enables **Post to eBay** (Sell Inventory API, user token) |
| `EBAY_APP_ID` | no | Reserved for eBay Browse API |
| `EBAY_ENV` | no | Set to `sandbox` to use eBay's sandbox |
| `STRIPE_SECRET_KEY` | no | Enables **Payment link** on the Sell page |

All API keys stay on the server. The browser only talks to `/api/*` routes.

## How it works

| Route | What it does |
| --- | --- |
| `POST /api/search` | One Exa search per vendor (with page text) → Claude extracts title, price, condition → drop anything without a grounded price → sort by price |
| `POST /api/filter` | The only agent step in Shop, run only when the shopper asks. Plain English plus the current results → Claude returns price/store/condition limits (applied in code) and which results fail anything else (model, size, color…) |
| `POST /api/price-check` | Exa comps on eBay / Mercari / Facebook → grounded prices → range plus a recommended price slightly under the lowest credible comp → listing copy per site |
| `POST /api/deals` | Exa search across coupon sites and retailer promo pages → grounded deals saved to SQLite with `foundAt` |
| `GET /api/deals?store=bestbuy` | Stored deals for a store that haven't expired (powers the "N deals" badges on search results) |
| `POST /api/ebay/list` | Inventory item → offer → publish (only when `EBAY_OAUTH_TOKEN` is set) |
| `POST /api/payment-link` | Stripe Payment Link at the chosen price (only when `STRIPE_SECRET_KEY` is set) |

Every Exa query and LLM extraction is cached in SQLite (`data/agent-shop.db`), keyed by its inputs. A repeated search is instant and works without a network connection. Deal searches refresh after 12 hours (the old copy is served if the refresh fails). Delete the file to clear the cache.

**Stack:** Next.js (App Router), TypeScript, Tailwind, better-sqlite3, exa-js, @anthropic-ai/sdk, zod.

## Known limitations

- **Facebook Marketplace posting is copy-and-open.** Meta has no public listing API, so we copy the listing to your clipboard and open Marketplace's create page. We never automate or scrape Facebook.
- **Facebook comps are sparse.** Few Marketplace pages are publicly indexed.
- **Deal codes are not auto-applied at checkout.** That would need a browser extension, which is out of scope.
- **eBay posting needs a fully set-up seller account** (business policies and an inventory location) and at least one public `https` photo URL. A locally uploaded photo isn't public when running on localhost.
- **Prices are whatever the indexed page said when it was crawled**, so they can lag the live site. Every result links to its source so you can check.
- **USD only.**
