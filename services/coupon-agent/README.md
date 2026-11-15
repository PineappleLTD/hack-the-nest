# Agent Shop coupons

A Python service for the Agent Shop coupon feature. Exa finds public offers on configured merchant domains and fetches fresh page content. OpenAI extracts codes backed by quoted text. SQLite keeps the inventory, and a LangChain agent answers optional natural-language lookups using that inventory. The regular list endpoint only queries SQLite.

## Run locally

From the repository root, with Python 3.11 or newer:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
test -f .env || cp .env.example .env
python -m coupon_agent serve
```

Open [the local API docs](http://127.0.0.1:8000/docs). Add your keys to the ignored `.env` and restart the service when ready. With blank keys, listing and importing work; live discovery requires both `OPENAI_API_KEY` and `EXA_API_KEY`, and natural-language lookup requires OpenAI. Edit `merchants.json` to add merchants or exact official promotion URLs. Search is restricted to the configured domains.

```sh
python -m coupon_agent import saved-coupons.json
python -m coupon_agent list --all
python -m coupon_agent refresh
curl 'http://127.0.0.1:8000/v1/coupons?merchant=eBay'
pytest -q
```

The import accepts a JSON array of objects with `merchant`, `code`, `discount`, and `source_url`. Optional `expires_at` must be an ISO timestamp with a UTC offset, and `terms` is a string. For example, the shape of an import is:

```json
[
  {
    "merchant": "eBay",
    "code": "EXAMPLE10",
    "discount": "10% off select items",
    "source_url": "https://www.ebay.com/example-promotion",
    "expires_at": "2026-12-01T05:00:00Z"
  }
]
```

This is a format example, not a live code. Imports stay hidden until a merchant page lists the code. A known expiry hides a code at its cutoff even if the refresh job is offline. A code disappears from shopper results when its source stops listing it or its last successful check is 30 hours old. Date-only cutoffs use the start of that date in the configured merchant time zone to err on the side of hiding it early. A merchant listing does not establish whether a shopper or cart qualifies at checkout.

## Daily refresh and Base44

The service runs a daily refresh at **6:00 a.m. Detroit time** by default. It catches up on the latest missed slot when started, and retries an unsuccessful run once. Keep one Python instance running with a persistent volume for `COUPON_DB` if you want refreshes while your computer is off. The SQLite database and schedule state are on the same volume.

Base44 runs the shopping app. The Python service runs separately because [Base44 backend functions run on Deno](https://docs.base44.com/developers/backend/resources/backend-functions/overview). For a deployed setup:

1. Host this Python service behind HTTPS with a persistent volume, one worker, and a generated `COUPON_API_TOKEN`. From the project root in a host/container, run `uvicorn coupon_agent.api:create_app --factory --host 0.0.0.0 --port 8000 --workers 1 --no-proxy-headers` (use the port your host expects).
2. Add [the couponLookup function](base44/functions/couponLookup/entry.js) to your Base44 project. Set the server secrets `COUPON_API_URL` (your service's HTTPS origin) and `COUPON_API_TOKEN` (the same value as on the service). Keep both provider keys on the Python side.
3. For the signed-in app, call `base44.functions.invoke("couponLookup", { merchant: "eBay" })` for a quick lookup or pass `{ question: "Do you have eBay coupons?" }` for the agent. Render the returned `coupons` with the source, terms and expiry if available. Label them “Merchant listed.” This service owns the daily refresh, so no second Base44 schedule is needed.
