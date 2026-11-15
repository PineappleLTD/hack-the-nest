import asyncio
import hmac
import logging
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from openai import APIError
from pydantic import BaseModel, StringConstraints

from .agent import ask, build_agent
from .schedule import daily_refresh
from .settings import Settings
from .store import Store

log = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)


class Question(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


def create_app(
    settings: Settings | None = None, *, allow_local_without_token: bool = False
) -> FastAPI:
    settings = settings or Settings.load()
    store = Store(settings.db)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store.init()
        app.state.agent = build_agent(settings, store) if settings.openai_key else None
        task = (
            asyncio.create_task(daily_refresh(settings, store))
            if settings.live_refresh_enabled
            else None
        )
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="Agent Shop Coupon API", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def no_cache(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    def authorize(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> None:
        if settings.api_token:
            received = credentials.credentials if credentials else ""
            if hmac.compare_digest(received.encode(), settings.api_token.encode()):
                return
            raise HTTPException(
                status_code=401,
                detail="Valid bearer token required.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if (
            not allow_local_without_token
            or request.client is None
            or request.client.host not in ("127.0.0.1", "::1")
        ):
            raise HTTPException(status_code=503, detail="COUPON_API_TOKEN is required.")

    @app.get("/health")
    def health():
        return {"status": "ok", "live_refresh_enabled": settings.live_refresh_enabled}

    @app.get("/v1/coupons", dependencies=[Depends(authorize)])
    def coupons(
        merchant: Annotated[str | None, Query(max_length=100)] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
    ):
        shop = settings.merchant_for(merchant) if merchant else None
        if merchant and shop is None:
            return {"coupons": []}
        rows = store.list(datetime.now(UTC), merchant=shop.domain if shop else None, limit=limit)
        return {"coupons": rows}

    @app.post("/v1/ask", dependencies=[Depends(authorize)])
    def ask_coupons(body: Question):
        agent = app.state.agent
        if agent is None:
            raise HTTPException(status_code=503, detail="Set OPENAI_API_KEY to enable coupon chat.")
        try:
            return ask(agent, body.question)
        except APIError as exc:
            log.warning("Coupon lookup failed (%s)", type(exc).__name__)
            raise HTTPException(status_code=502, detail="Coupon agent unavailable.") from None

    return app
