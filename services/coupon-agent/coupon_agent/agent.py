from datetime import UTC, datetime
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain.tools import tool
from langchain_core.messages import ToolMessage
from langchain_openai import ChatOpenAI

from .settings import Settings
from .store import Store


def build_agent(settings: Settings, store: Store, *, model: Any = None):
    @tool(return_direct=True, response_format="content_and_artifact")
    def find_coupons(merchant: str = "", keyword: str = "") -> tuple[str, list[dict]]:
        """Find current saved coupons by merchant name/domain and optional exact term."""
        shop = settings.merchant_for(merchant)
        if merchant.strip() and shop is None:
            return "That merchant is not configured.", []
        rows = store.list(
            datetime.now(UTC),
            merchant=shop.domain if shop else None,
            contains=keyword.strip()[:80] or None,
            limit=10,
        )
        return f"Found {len(rows)} current merchant-listed coupons.", rows

    if model is None:
        model = ChatOpenAI(
            api_key=settings.openai_key,
            model=settings.model,
            timeout=20,
            max_retries=1,
            max_tokens=800,
        )
    return create_agent(
        model=model,
        tools=[find_coupons],
        middleware=[ModelCallLimitMiddleware(run_limit=2)],
        system_prompt=(
            "You help shoppers find saved coupon codes. Use find_coupons for every coupon "
            "question. Set merchant only if the user names a store, even if unsupported. "
            "Set keyword only for a specific code, product or restriction; use one literal "
            "term. If no merchant or term is specified, leave that argument empty. "
            "Never guess a coupon, discount, expiration date, or checkout success."
        ),
    )


def ask(agent, question: str) -> dict:
    state = agent.invoke(
        {"messages": [{"role": "user", "content": question}]},
        config={"recursion_limit": 10},
    )
    rows = {
        (row["merchant"], row["code"]): row
        for message in state["messages"]
        if isinstance(message, ToolMessage) and isinstance(message.artifact, list)
        for row in message.artifact
    }
    coupons = list(rows.values())[:20]
    message = (
        f"Found {len(coupons)} current merchant-listed coupons."
        if coupons
        else "No saved coupons matched that request."
    )
    return {"message": message, "coupons": coupons}
