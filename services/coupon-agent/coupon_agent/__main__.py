import argparse
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import uvicorn
from pydantic import AwareDatetime, BaseModel, Field, TypeAdapter

from .refresh import run_refresh
from .settings import Settings, merchant_url
from .store import CODE, Offer, Store


class SavedOffer(BaseModel, extra="forbid", str_strip_whitespace=True):
    merchant: str
    code: str = Field(pattern=CODE.pattern, min_length=2, max_length=40)
    discount: str = Field(min_length=2, max_length=100)
    source_url: str
    expires_at: AwareDatetime | None = None
    terms: str = Field(default="", max_length=550)


def import_offers(settings: Settings, store: Store, path: Path) -> int:
    items = TypeAdapter(list[SavedOffer]).validate_json(path.read_text())
    offers = []
    for item in items:
        shop = settings.merchant_for(item.merchant)
        if shop is None or not merchant_url(item.source_url, shop.domain):
            raise ValueError("Each coupon needs a configured merchant and a merchant HTTPS URL.")
        if not CODE.fullmatch(item.code):
            raise ValueError("Coupon codes may contain letters, numbers, hyphens, and underscores.")
        offers.append(Offer(**(item.model_dump() | {"merchant": shop.domain})))
    store.save(offers)
    return len(offers)


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage Agent Shop coupons")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="Start the API and its daily job on localhost")
    serve.add_argument("--port", type=int, default=8000)
    save = commands.add_parser("import", help="Save coupon candidates from a JSON array")
    save.add_argument("file", type=Path)
    listing = commands.add_parser("list", help="List current saved coupons")
    listing.add_argument("--all", action="store_true", help="Include inactive statuses")
    commands.add_parser("refresh", help="Run a refresh immediately")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    try:
        settings = Settings.load()
        if args.command == "serve":
            from .api import create_app

            uvicorn.run(
                create_app(settings, allow_local_without_token=True),
                host="127.0.0.1",
                port=args.port,
                proxy_headers=False,
            )
            return 0
        store = Store(settings.db)
        store.init()
        if args.command == "import":
            result = {"accepted": import_offers(settings, store, args.file)}
        elif args.command == "list":
            result = {
                "coupons": store.list(datetime.now(UTC), include_inactive=args.all, limit=200)
            }
        else:
            result = run_refresh(settings, store)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"{exc}\n")

    print(json.dumps(result, indent=2))
    if args.command == "refresh":
        return int(
            not result["live_refresh"] or any(row["failures"] for row in result["merchants"])
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
