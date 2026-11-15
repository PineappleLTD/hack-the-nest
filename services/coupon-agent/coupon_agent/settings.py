import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import dotenv_values
from pydantic import BaseModel, Field, TypeAdapter, field_validator

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")


class Merchant(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    domain: str
    timezone: str = "America/Detroit"
    urls: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("domain")
    @classmethod
    def valid_domain(cls, value: str) -> str:
        value = value.strip().lower()
        if not DOMAIN.fullmatch(value):
            raise ValueError("expected a merchant domain such as ebay.com")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("expected an IANA time zone such as America/Detroit") from exc
        return value


def merchant_url(url: str, domain: str) -> bool:
    if len(url) > 2048 or any(char.isspace() or char == "\\" for char in url):
        return False
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        return (
            parts.scheme == "https"
            and parts.username is None
            and parts.password is None
            and parts.port in (None, 443)
            and (host == domain or host.endswith("." + domain))
        )
    except ValueError:
        return False


@dataclass(frozen=True)
class Settings:
    db: Path
    merchants: tuple[Merchant, ...]
    timezone: ZoneInfo
    refresh_hour: int
    openai_key: str = ""
    exa_key: str = ""
    api_token: str = ""
    model: str = "gpt-4.1-mini"

    @property
    def live_refresh_enabled(self) -> bool:
        return bool(self.openai_key and self.exa_key and self.merchants)

    def merchant_for(self, name: str) -> Merchant | None:
        key = name.strip().casefold()
        return next(
            (m for m in self.merchants if key in (m.name.casefold(), m.domain)),
            None,
        )

    @classmethod
    def load(cls) -> "Settings":
        env = dotenv_values(ROOT / ".env", interpolate=False)

        def setting(key: str, default: str = "") -> str:
            return (os.environ.get(key, env.get(key, default)) or default).strip()

        hour = int(setting("COUPON_REFRESH_HOUR", "6"))
        if not 0 <= hour <= 23:
            raise ValueError("COUPON_REFRESH_HOUR must be between 0 and 23.")
        path = ROOT / setting("COUPON_MERCHANTS", "merchants.json")
        merchants = TypeAdapter(list[Merchant]).validate_json(path.read_text())
        if len(merchants) > 20 or len({m.domain for m in merchants}) != len(merchants):
            raise ValueError("Configure at most 20 distinct merchant domains.")
        for merchant in merchants:
            if any(not merchant_url(url, merchant.domain) for url in merchant.urls):
                raise ValueError(f"URLs must belong to {merchant.domain} and use HTTPS.")
        return cls(
            db=ROOT / setting("COUPON_DB", "data/coupons.sqlite3"),
            merchants=tuple(merchants),
            timezone=ZoneInfo(setting("COUPON_TIMEZONE", "America/Detroit")),
            refresh_hour=hour,
            openai_key=setting("OPENAI_API_KEY"),
            exa_key=setting("EXA_API_KEY"),
            api_token=setting("COUPON_API_TOKEN"),
            model=setting("OPENAI_MODEL", "gpt-4.1-mini"),
        )
