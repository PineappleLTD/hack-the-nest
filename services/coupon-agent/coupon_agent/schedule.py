import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from .refresh import run_refresh
from .settings import Settings
from .store import Store

log = logging.getLogger(__name__)


def latest_slot(settings: Settings, now: datetime) -> str:
    local = now.astimezone(settings.timezone)
    day = local.date() - timedelta(days=local.hour < settings.refresh_hour)
    return day.isoformat()


def run_due(
    settings: Settings,
    store: Store,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> dict | None:
    now = clock()
    slot = latest_slot(settings, now)
    if not settings.live_refresh_enabled or not store.claim_slot(slot, now):
        return None
    report = run_refresh(settings, store)
    success = not any(merchant["failures"] for merchant in report["merchants"])
    store.finish_slot(slot, clock(), success=success)
    return report


async def daily_refresh(settings: Settings, store: Store) -> None:
    while True:
        try:
            report = await asyncio.to_thread(run_due, settings, store)
            if report is not None:
                log.info("Daily coupon refresh: %s", json.dumps(report))
        except Exception:
            log.exception("Daily coupon refresh failed")
        await asyncio.sleep(60)
