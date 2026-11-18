from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_quote_cache import MarketQuoteCache
from app.models.user import LIQUIDITY_PROVIDER_IDENTITY, User
from app.services.ledger_service import append_event, ensure_opening
from app.services.trade_execution import add_position, notional_amount

_NEW_YORK = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class SimulatedFill:
    quantity: Decimal
    price: Decimal
    quote_at: datetime


def is_confirmed_close(quote: MarketQuoteCache) -> bool:
    if quote.quote_at is None:
        return False
    if quote.source != "yahoo":
        return True
    # Legacy caches may contain a Yahoo daily bar captured during its session.
    fetched_day = quote.fetched_at.replace(tzinfo=timezone.utc).astimezone(_NEW_YORK).date()
    return quote.quote_at.date() < fetched_day


def plan_simulated_fill(
    side: str, limit_price: Decimal | None, remaining: Decimal, quote: MarketQuoteCache
) -> tuple[SimulatedFill | None, str | None]:
    """Plan one tranche after the caller has validated the quote and matched customers."""
    if not settings.simulated_liquidity_enabled or remaining == 0:
        return None, None
    if not is_confirmed_close(quote):
        return None, "Waiting for a confirmed end-of-day close."
    if limit_price is not None:
        crosses = limit_price >= quote.price if side == "buy" else limit_price <= quote.price
        if not crosses:
            return None, "The latest close has not reached your limit price."
    quantity = min(remaining, Decimal(settings.simulated_liquidity_max_shares))
    if notional_amount(quantity, quote.price) == 0:
        return None, "The fill value at the latest close rounds to less than $0.01."
    reason = None
    if quantity < remaining:
        reason = "This order reached the simulated share cap for the latest close."
    return SimulatedFill(quantity, quote.price, quote.quote_at), reason


def simulated_provenance(quote_at: datetime | None) -> dict:
    if quote_at is None:
        return {}
    return {"simulated_quote_date": quote_at.date().isoformat()}


def provision_counterparty(
    db: Session, asset: Asset, customer_side: str, fill: SimulatedFill
) -> User:
    """Fund a system shortfall while holding the trading state and symbol locks."""
    provider = db.execute(select(User).where(User.is_system).with_for_update()).scalar_one_or_none()
    if provider is None:
        provider = User(email=LIQUIDITY_PROVIDER_IDENTITY, password_hash="!",
                        full_name="Sentinel Simulated Liquidity", cash_balance=Decimal(0))
        db.add(provider)
        db.flush()
        ensure_opening(db, provider)

    # Reuse inventory and cash received from earlier fills before issuing more.
    if customer_side == "buy":
        holding = db.execute(select(Holding).where(Holding.user_id == provider.id,
                                                  Holding.asset_id == asset.id)).scalar_one_or_none()
        shortfall = fill.quantity - (holding.quantity if holding is not None else Decimal(0))
        if shortfall > 0:
            add_position(db, provider, asset, holding, shortfall, fill.price)
            unit = f"ASSET:{asset.id}"
            append_event(db, provider.id, "simulated_liquidity_issuance", [
                ("position", asset.id, unit, shortfall), ("offset", asset.id, unit, -shortfall),
            ])
    else:
        shortfall = notional_amount(fill.quantity, fill.price) - provider.cash_balance
        if shortfall > 0:
            provider.cash_balance += shortfall
            append_event(db, provider.id, "simulated_liquidity_issuance", [
                ("cash", None, "USD", shortfall), ("offset", None, "USD", -shortfall),
            ])
    db.flush()
    return provider
