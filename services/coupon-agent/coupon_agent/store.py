import re
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

FRESH_FOR = timedelta(hours=30)
CODE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{1,39}")


def has_code(text: str, code: str) -> bool:
    return bool(re.search(rf"(?<![\w-]){re.escape(code)}(?![\w-])", text))


def timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Use an expiry timestamp with a UTC offset.")
    return value.astimezone(UTC).isoformat(timespec="microseconds")


@dataclass(frozen=True)
class Offer:
    merchant: str
    code: str
    discount: str
    source_url: str
    expires_at: datetime | None = None
    terms: str = ""


class Store:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def init(self) -> None:
        with self.connect() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript("""
                CREATE TABLE IF NOT EXISTS coupons (
                    merchant TEXT NOT NULL,
                    code TEXT NOT NULL,
                    discount TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    expires_at TEXT,
                    terms TEXT NOT NULL,
                    checked_at TEXT,
                    fresh_until TEXT,
                    withdrawn_at TEXT,
                    PRIMARY KEY (merchant, code)
                );
                CREATE INDEX IF NOT EXISTS coupon_freshness
                    ON coupons (merchant, fresh_until);
                CREATE TABLE IF NOT EXISTS refresh_runs (
                    slot TEXT PRIMARY KEY,
                    attempts INTEGER NOT NULL,
                    ready_at TEXT NOT NULL,
                    finished INTEGER NOT NULL DEFAULT 0
                );
            """)

    def save(self, offers: Sequence[Offer]) -> None:
        with self.connect() as con:
            con.executemany(
                """
                INSERT INTO coupons (merchant, code, discount, source_url, expires_at, terms)
                VALUES (:merchant, :code, :discount, :source_url, :expires_at, :terms)
                ON CONFLICT (merchant, code) DO UPDATE SET
                    discount = excluded.discount,
                    source_url = excluded.source_url,
                    expires_at = COALESCE(excluded.expires_at, coupons.expires_at),
                    terms = excluded.terms
                WHERE coupons.checked_at IS NULL
                """,
                [_record(offer) for offer in offers],
            )

    def sources(self, merchant: str, now: datetime) -> list[str]:
        with self.connect() as con:
            return [
                row["source_url"]
                for row in con.execute(
                    """
                    SELECT DISTINCT source_url FROM coupons
                    WHERE merchant = ? AND withdrawn_at IS NULL
                        AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY source_url
                    """,
                    (merchant, timestamp(now)),
                )
            ]

    def reconcile(
        self,
        merchant: str,
        checked_urls: set[str],
        offers: Sequence[Offer],
        now: datetime,
    ) -> None:
        checked = timestamp(now)
        fresh = timestamp(now + FRESH_FOR)
        with self.connect() as con:
            # Successful extractions replace evidence for this page. Failed reads leave it alone.
            con.executemany(
                """
                UPDATE coupons SET withdrawn_at = ?
                WHERE merchant = ? AND source_url = ?
                    AND checked_at IS NOT NULL AND checked_at <= ?
                """,
                [(checked, merchant, url, checked) for url in checked_urls],
            )
            con.executemany(
                """
                INSERT INTO coupons (merchant, code, discount, source_url, expires_at, terms,
                                     checked_at, fresh_until)
                VALUES (:merchant, :code, :discount, :source_url, :expires_at, :terms,
                        :checked_at, :fresh_until)
                ON CONFLICT (merchant, code) DO UPDATE SET
                    discount = excluded.discount,
                    source_url = excluded.source_url,
                    expires_at = COALESCE(excluded.expires_at, coupons.expires_at),
                    terms = excluded.terms,
                    checked_at = excluded.checked_at,
                    fresh_until = excluded.fresh_until,
                    withdrawn_at = NULL
                WHERE coupons.checked_at IS NULL OR coupons.checked_at <= excluded.checked_at
                """,
                [
                    _record(offer) | {"checked_at": checked, "fresh_until": fresh}
                    for offer in offers
                ],
            )

    def claim_slot(self, slot: str, now: datetime) -> bool:
        with self.connect() as con:
            result = con.execute(
                """
                INSERT INTO refresh_runs (slot, attempts, ready_at) VALUES (?, 1, ?)
                ON CONFLICT (slot) DO UPDATE SET
                    attempts = refresh_runs.attempts + 1, ready_at = excluded.ready_at
                WHERE finished = 0 AND attempts < 2 AND ready_at <= ?
                """,
                (slot, timestamp(now + timedelta(hours=1)), timestamp(now)),
            )
            return result.rowcount == 1

    def finish_slot(self, slot: str, now: datetime, *, success: bool) -> None:
        with self.connect() as con:
            con.execute(
                "UPDATE refresh_runs SET ready_at = ?, finished = ? WHERE slot = ?",
                (timestamp(now + timedelta(minutes=15)), success, slot),
            )

    def list(
        self,
        now: datetime,
        *,
        merchant: str | None = None,
        contains: str | None = None,
        include_inactive: bool = False,
        limit: int = 30,
    ) -> list[dict]:
        checked = timestamp(now)
        with self.connect() as con:
            return [
                dict(row)
                for row in con.execute(
                    """
                    WITH inventory AS (
                        SELECT merchant, code, discount, source_url, expires_at, terms,
                               checked_at,
                               CASE
                                   WHEN expires_at <= :now THEN 'expired'
                                   WHEN withdrawn_at IS NOT NULL THEN 'withdrawn'
                                   WHEN checked_at IS NULL THEN 'saved'
                                   WHEN fresh_until <= :now THEN 'stale'
                                   ELSE 'merchant_listed'
                               END AS status
                        FROM coupons
                        WHERE (:merchant IS NULL OR merchant = :merchant)
                          AND (:contains IS NULL OR instr(
                               lower(code || ' ' || discount || ' ' || terms), :contains) > 0)
                    )
                    SELECT * FROM inventory
                    WHERE :include_inactive OR status = 'merchant_listed'
                    ORDER BY checked_at DESC, merchant, code
                    LIMIT :limit
                    """,
                    {
                        "now": checked,
                        "merchant": merchant,
                        "contains": contains.lower() if contains else None,
                        "include_inactive": include_inactive,
                        "limit": limit,
                    },
                )
            ]


def _record(offer: Offer) -> dict:
    return asdict(offer) | {
        "expires_at": timestamp(offer.expires_at) if offer.expires_at else None,
    }
