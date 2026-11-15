---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: []
---

# Shop (home + results)

Scope: `/` — the hero search and the live results list. Mode: Operate (the visitor finds the cheapest credible listing), with one pinned expressive first viewport.

Audience/job: a shopper who knows the product; types it, scans prices, clicks through. Constraints: search is a live web lookup (seconds; cached repeats are instant); every price links to its source page. User asked for simplicity above everything, nothing extra.

## Direction contract

THESIS: One search bar on a black night field; the cart mark arrives through liquid glass, you type, and prices rise into a single cheapest-first ladder. Refuses the category default of a light marketplace grid of identical product cards.

OWN-WORLD: Pure black ground with slow white particle dust terrain (pineapplehacks technique), basket's orange #FF5A1F as the only colour, white text at 90/55 percent, 1px hairlines, 6px radii, system UI font (SF Pro on Apple) at light display weight and regular UI weight, tabular numerals, light image wells for product photos.

STORY: The visitor sees what this is (find it for less, six named stores), types, and results appear without pressing Enter; the cheapest is marked, others show how much more they cost; a row click opens the real store page.

FIRST VIEWPORT: Nav (animated cart mark + wordmark left, Shop/Sell/Deals right). Centre: glass-reveal cart (~300px stage) above a light-weight headline and one muted line, then the store-category search bar (max 640px) with four suggestion buttons; dust terrain fills the lower half.

FORM: seed: none (pinned) — "modeled off https://www.pineapplehacks.com/ for that kind of style (nice animations) + the basket frontend", "the logo should feel almost a bit animated, and look like a simple shopping cart", "you should be able to just type something in the search bar and it'll show up". Signature interaction: typing collapses the hero, the bar rises to the top, the dust dims and stirs while searching, rows arrive in price order.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
