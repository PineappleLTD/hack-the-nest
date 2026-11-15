from dataclasses import replace
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from coupon_agent.__main__ import import_offers
from coupon_agent.agent import ask, build_agent
from coupon_agent.api import create_app
from coupon_agent.refresh import Candidate, Exa, Extracted, Page, grounded_offers, refresh
from coupon_agent.schedule import latest_slot, run_due
from coupon_agent.settings import Merchant, Settings
from coupon_agent.store import Offer, Store

MERCHANT = Merchant(name="Example Store", domain="example.com")
URL = "https://example.com/deals"
NOW = datetime(2026, 11, 14, 11, tzinfo=UTC)


@pytest.fixture
def settings(tmp_path):
    return Settings(tmp_path / "coupons.sqlite3", (MERCHANT,), ZoneInfo("America/Detroit"), 6)


@pytest.fixture
def store(settings):
    result = Store(settings.db)
    result.init()
    return result


def test_import_stays_hidden_until_refresh_and_expires_on_time(tmp_path, settings, store):
    path = tmp_path / "saved.json"
    path.write_text(
        '[{"merchant":"Example Store","code":"SAVE10","discount":"10% off",'
        '"source_url":"https://example.com/deals","expires_at":"2026-11-14T07:00:00-05:00"}]'
    )
    assert import_offers(settings, store, path) == 1
    assert store.list(NOW) == []
    assert store.list(NOW, include_inactive=True)[0]["status"] == "saved"

    store.reconcile("example.com", {URL}, [Offer("example.com", "SAVE10", "10% off", URL)], NOW)
    assert store.list(NOW)[0]["code"] == "SAVE10"
    assert store.list(NOW + timedelta(hours=1)) == []
    assert store.list(NOW + timedelta(hours=1), include_inactive=True)[0]["status"] == "expired"


def test_import_is_atomic_if_a_url_is_not_a_merchant_page(tmp_path, settings, store):
    path = tmp_path / "saved.json"
    path.write_text(
        '[{"merchant":"Example Store","code":"SAVE10","discount":"10% off",'
        '"source_url":"https://example.com/deals"},'
        '{"merchant":"Example Store","code":"BAD","discount":"90% off",'
        '"source_url":"https://example.com.other.net/deals"}]'
    )
    with pytest.raises(ValueError, match="merchant HTTPS URL"):
        import_offers(settings, store, path)
    assert store.list(NOW, include_inactive=True) == []


def test_failed_crawl_does_not_withdraw_and_successful_removal_does(store):
    offer = Offer(MERCHANT.domain, "SAVE10", "10% off", URL)
    store.save([offer])

    class Source:
        text = "10% off when you use SAVE10."
        fail = False

        def search(self, merchant):
            return []

        def fetch(self, urls, merchant):
            assert urls == [URL]
            return {} if self.fail else {URL: Page(URL, self.text)}

    source = Source()

    def extract(merchant, page, now):
        return [offer] if "SAVE10" in page.text else []

    assert refresh(store, [MERCHANT], source, extract, lambda: NOW)["merchants"][0]["failures"] == 0
    source.fail = True
    next_day = NOW + timedelta(days=1)
    assert (
        refresh(store, [MERCHANT], source, extract, lambda: next_day)["merchants"][0]["failures"]
        == 1
    )
    assert store.list(next_day)[0]["code"] == "SAVE10"
    assert store.list(NOW + timedelta(hours=30)) == []

    source.fail = False
    source.text = "No offers today."
    refresh(store, [MERCHANT], source, extract, lambda: next_day)
    assert store.list(next_day) == []
    assert store.list(next_day, include_inactive=True)[0]["status"] == "withdrawn"


def test_grounding_rejects_invented_codes_and_expired_offers():
    passage = "Use SAVE10 for 10% off. Ends November 15, 2026."
    valid = Candidate(
        code="SAVE10",
        discount="10% off",
        evidence=passage,
        expiry_evidence="Ends November 15, 2026",
        expiry="2026-11-15",
    )
    invalid = [
        valid.model_copy(update={"code": "AVE10"}),
        valid.model_copy(update={"evidence": "Use SAVE10 for 10% off today only."}),
        valid.model_copy(update={"expiry": "2026-11-13"}),
    ]
    page = Page(URL, "Promotions\n" + passage)
    offers = grounded_offers(MERCHANT, page, Extracted(coupons=[valid, *invalid]), NOW)
    assert len(offers) == 1
    assert offers[0].expires_at == datetime(2026, 11, 15, 5, tzinfo=UTC)


def test_exa_uses_fresh_content_only():
    def handle(request):
        assert request.url.path == "/contents"
        assert b'"maxAgeHours":0' in request.content
        cached = f"{URL}/cached"
        return httpx.Response(
            200,
            json={
                "results": [
                    {"id": URL, "url": URL, "text": "Public offers here"},
                    {"id": cached, "url": cached, "text": "Outdated offers"},
                ],
                "statuses": [
                    {"id": URL, "status": "success", "source": "crawled"},
                    {"id": cached, "status": "success", "source": "cached"},
                ],
            },
        )

    with httpx.Client(
        base_url="https://api.exa.ai", transport=httpx.MockTransport(handle)
    ) as client:
        result = Exa(client).fetch([URL, f"{URL}/cached"], MERCHANT)
    assert list(result) == [URL]


def test_scheduler_daily_slot_and_retry(monkeypatch, settings, store):
    settings = replace(settings, openai_key="offline", exa_key="offline")
    reports = iter(
        [
            {"merchants": [{"failures": 1}]},
            {"merchants": [{"failures": 0}]},
            {"merchants": [{"failures": 0}]},
        ]
    )
    monkeypatch.setattr("coupon_agent.schedule.run_refresh", lambda *_: next(reports))
    assert latest_slot(settings, NOW - timedelta(minutes=1)) == "2026-11-13"
    assert run_due(settings, store, lambda: NOW) is not None
    assert run_due(settings, store, lambda: NOW + timedelta(minutes=14)) is None
    assert run_due(settings, store, lambda: NOW + timedelta(minutes=15)) is not None
    assert run_due(settings, store, lambda: NOW + timedelta(hours=2)) is None
    assert run_due(settings, store, lambda: NOW + timedelta(days=1)) is not None


def test_langchain_returns_only_tool_rows(settings, store):
    class FakeModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):
            return self

    now = datetime.now(UTC)
    store.reconcile(
        MERCHANT.domain,
        {URL},
        [
            Offer(MERCHANT.domain, "SAVE10", "10% off", URL),
            Offer(MERCHANT.domain, "PAST20", "20% off", URL, now),
        ],
        now,
    )
    model = FakeModel(
        messages=iter(
            [
                AIMessage(
                    content="Try NOT-A-REAL-CODE",
                    tool_calls=[
                        {
                            "name": "find_coupons",
                            "args": {"merchant": MERCHANT.name},
                            "id": "call-1",
                        },
                    ],
                )
            ]
        )
    )
    result = ask(build_agent(settings, store, model=model), "What offers does Example Store have?")
    assert [row["code"] for row in result["coupons"]] == ["SAVE10"]
    assert "NOT-A-REAL-CODE" not in result["message"]


def test_authenticated_api_reads_database_with_no_provider_keys(settings, store):
    store.reconcile(
        MERCHANT.domain,
        {URL},
        [
            Offer(MERCHANT.domain, "SAVE10", "10% off", URL),
        ],
        datetime.now(UTC),
    )
    with TestClient(create_app(replace(settings, api_token="test-only"))) as client:
        assert client.get("/v1/coupons").status_code == 401
        headers = {"Authorization": "Bearer test-only"}
        response = client.get("/v1/coupons?merchant=example.com", headers=headers)
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["coupons"][0]["code"] == "SAVE10"
        assert client.get("/v1/coupons?merchant=other", headers=headers).json() == {"coupons": []}
        assert (
            client.post("/v1/ask", json={"question": "Any deals?"}, headers=headers).status_code
            == 503
        )


def test_only_local_cli_mode_can_read_without_a_token(settings):
    loopback = ("127.0.0.1", 50000)
    with TestClient(create_app(settings), client=loopback) as client:
        assert client.get("/v1/coupons").status_code == 503
    with TestClient(
        create_app(settings, allow_local_without_token=True), client=loopback
    ) as client:
        assert client.get("/v1/coupons").json() == {"coupons": []}


def test_daily_refresh_covers_all_saved_sources_across_batches(store):
    urls = [f"{URL}/{i}" for i in range(25)]
    store.save([Offer(MERCHANT.domain, f"CODE{i}", "10% off", url) for i, url in enumerate(urls)])
    batches = []

    class Source:
        def search(self, merchant):
            return []

        def fetch(self, urls, merchant):
            batches.append(set(urls))
            return {url: Page(url, "No promotions") for url in urls}

    result = refresh(store, [MERCHANT], Source(), lambda *_: [], lambda: NOW)
    assert len(batches) > 1
    assert set.union(*batches) == set(urls)
    assert result["merchants"][0]["failures"] == 0
