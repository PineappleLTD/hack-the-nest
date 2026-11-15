# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Shoppers who already know what they want to buy and want the lowest real price for it right now. They type a product name, scan prices across stores, and click through to buy. The same person occasionally uses two supporting tools: pricing something they want to resell (Sell) and finding a working coupon for a store (Deals).

## Product Purpose

Agent Shop puts six stores behind one search bar. Results come from Amazon, eBay, Etsy, Best Buy, Walmart and Target, sorted lowest price first, and a plain-English filter box narrows them ("new only, under $200, from Best Buy or Amazon"). Success is a shopper getting from a typed product name to the cheapest credible listing with as little effort and waiting as possible.

## Positioning

Speed and ease first: one search bar replaces visiting six stores, and the cheapest option is at the top. Trust is table stakes, not the headline: every price links to the real page it was read from, the quoted price text must appear on that page, and there are no affiliate links and no tracking.

## Operating Context

- Search is a live web lookup (Exa) plus LLM extraction, so a fresh query takes several seconds; repeated queries are served from a local SQLite cache and are instant.
- Results carry: title, price (USD), store, condition (new, used, refurbished, unknown), product image when the page has one, and a link to the source page. Stores with stored deals show a deal count.
- Sell: describe an item, get comparable listings from eBay, Mercari and Facebook Marketplace, a recommended price per site, and listing copy. Optional actions: post to eBay, create a Stripe payment link, copy-and-open Facebook Marketplace.
- Deals: coupon codes and sales for a store, each linked to the page it was found on, with how long ago it was found.

## Capabilities and Constraints

- Next.js App Router, TypeScript, Tailwind. All API keys stay on the server; the browser only calls `/api/*`.
- Requires `EXA_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`. eBay posting and Stripe links are optional and only appear when their keys are set.
- USD only. Prices can lag the live store page because they come from the indexed copy.
- Facebook Marketplace has no listing API: posting is copy-and-open only.
- Deal codes are not auto-applied at checkout.

## Brand Commitments

- Name: Agent Shop.
- The user named two visual references for the current redesign: pineapplehacks.com (black, particle-field motion) and their own "basket" app frontend. Those are design-direction inputs, recorded here only as references the user made binding for this redesign.

## Evidence on Hand

- No testimonials, user counts, savings figures, or partner logos exist. Do not invent any.
- `scripts/seed.mjs` warms the cache with demo queries for live demos.

## Product Principles

1. The search bar is the product. Everything else gets out of its way.
2. Cheapest first, always. Ordering and emphasis follow price.
3. Every number is clickable proof: a price or deal always links to its source page.
4. Fast to scan: a shopper should read the answer in one glance, not study a layout.
