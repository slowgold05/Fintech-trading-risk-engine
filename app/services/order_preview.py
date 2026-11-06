"""Indicative read-only order preview.

Submission through place_order revalidates. An eligible preview does not reserve
cash or shares and does not authorize step-up.
"""

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trading_halt import TradingHaltState
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.mfa import confirmed_factor
from app.services.order_book import allocate_slices, resting_makers_select
from app.services.pretrade_controls import _price_band_problem, require_stock_concentration, trading_halt_reason
from app.services.trade_execution import notional_amount, reserved_cash, reserved_shares


CENT = Decimal("0.01")
SIX_PLACES = Decimal("0.000001")
UPLIFT = Decimal("1.20")
LIQUIDITY = "Unavailable liquidity"
DUST = "Trade value must be at least $0.01"
CONCENTRATION_REASONS = {
    "Stock concentration limit exceeded (SM-PT-03)",
    "Stock position-size limit exceeded (SM-PT-05)",
}
ESTIMATE_FIELDS = (
    "initial_reservation",
    "estimated_fill_quantity",
    "estimated_fill_notional",
    "unfilled_quantity",
)


def preview_order(db: Session, user_id: int, payload: OrderCreate) -> dict:
    """Preview one order inside a single read-only snapshot.

    consistent_read rollbacks first, so the dependency user is stale. The owner
    is reloaded by id before any balance is copied.
    """
    with consistent_read(db):
        read_at = snapshot_clock(db)
        owner = db.execute(select(User).where(User.id == user_id)).scalar_one()
        return _preview_snapshot(db, owner, payload, read_at)


def _preview_snapshot(db: Session, owner: User, payload: OrderCreate, read_at: datetime) -> dict:
    owner_id = owner.id
    owner_cash = _required_decimal(owner.cash_balance)
    state = db.execute(select(TradingHaltState).where(TradingHaltState.id == 1)).scalar_one_or_none()
    symbol = db.execute(
        select(MarketSymbol).where(MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True))
    ).scalar_one_or_none()
    quote = db.execute(select(MarketQuoteCache).where(MarketQuoteCache.symbol == payload.symbol)).scalar_one_or_none()
    asset = db.execute(select(Asset).where(Asset.symbol == payload.symbol)).scalar_one_or_none()
    observed_at = None if quote is None else quote.quote_at

    owner_reserved = reserved_cash(db, owner_id)
    owner_shares = Decimal(0)
    open_sells = Decimal(0)
    stock_known = symbol is not None and (asset is None or asset.asset_type == "stock")
    if stock_known and asset is not None:
        held = db.execute(
            select(Holding.quantity).where(Holding.user_id == owner_id, Holding.asset_id == asset.id)
        ).scalar_one_or_none()
        if held is not None:
            owner_shares = _required_decimal(held)
        open_sells = reserved_shares(db, owner_id, asset.id)
    sell_available = _quantity(owner_shares - open_sells) if stock_known else None
    buying_power = owner_cash - owner_reserved
    step_up = _step_up_required(db, owner_id, payload, quote, read_at)

    def finish(
        status: str,
        reason: str | None,
        *,
        fill_quantity: Decimal = Decimal(0),
        fill_notional: Decimal = Decimal(0),
        reservation: Decimal | None = None,
    ) -> dict:
        if status == "eligible":
            initial = None if payload.side == "sell" else _money(Decimal(0) if reservation is None else reservation)
            estimates = {
                "initial_reservation": initial,
                "estimated_fill_quantity": _quantity(fill_quantity),
                "estimated_fill_notional": _money(fill_notional),
                "unfilled_quantity": _quantity(payload.quantity - fill_quantity),
            }
        else:
            estimates = {field: None for field in ESTIMATE_FIELDS}
        return {
            "symbol": payload.symbol,
            "side": payload.side,
            "order_type": payload.order_type,
            "quantity": _quantity(payload.quantity),
            "limit_price": None if payload.limit_price is None else _quantity(payload.limit_price),
            "read_at": _utc_z(read_at),
            "quote_observed_at": None if observed_at is None else _utc_z(observed_at),
            "status": status,
            "reason": reason,
            "step_up_required": step_up,
            "buying_power": _money(buying_power),
            "sell_available": sell_available,
            **estimates,
        }

    halt = trading_halt_reason(state)
    if halt is not None:
        return finish("blocked", halt)
    if symbol is None:
        return finish("blocked", "Unknown or inactive stock symbol")
    band = _price_band_problem(quote, payload.limit_price, now=read_at)
    if band is not None:
        return finish(*_control(band))
    if asset is not None and asset.asset_type != "stock":
        return finish("blocked", "Symbol is registered as another asset type")

    # A missing asset is an empty book. Do not insert a row and do not query a null id.
    makers = []
    if asset is not None:
        makers = db.execute(resting_makers_select(asset.id, owner_id, payload)).scalars().all()
    slices = _slice_copies(allocate_slices(payload.quantity, makers))

    reservation: Decimal | None = None
    if payload.side == "buy":
        if payload.order_type == "limit":
            reservation = notional_amount(payload.quantity, payload.limit_price)
        else:
            reservation = _market_reservation(slices)
            if reservation is None:
                return finish("unavailable", LIQUIDITY)
        if reservation > owner_cash - owner_reserved:
            return finish("blocked", "Insufficient buying power")
        reference_price = _required_decimal(quote.price)
        risk_price = payload.limit_price if payload.limit_price is not None else reference_price * UPLIFT
        try:
            require_stock_concentration(
                db, owner, asset, payload.quantity, reference_price, risk_price, now=read_at
            )
        except HTTPException as exc:
            if exc.status_code == 400 and exc.detail in CONCENTRATION_REASONS:
                return finish("blocked", str(exc.detail))
            raise
    elif asset is None or payload.quantity > owner_shares - open_sells:
        return finish("blocked", "Not enough holdings to sell")

    cash, shares, reserved, remaining, bad_users = _accounts(
        db, owner_id, owner_cash, owner_shares, owner_reserved, asset, slices
    )
    settled = _settle(
        payload, owner_id, quote, read_at, slices, cash, shares, reserved, remaining, bad_users
    )
    if settled[0] != "eligible":
        return finish(settled[0], settled[1])
    return finish(
        "eligible",
        None,
        fill_quantity=settled[2],
        fill_notional=settled[3],
        reservation=reservation,
    )


def _step_up_required(
    db: Session,
    user_id: int,
    payload: OrderCreate,
    quote: MarketQuoteCache | None,
    read_at: datetime,
) -> bool | None:
    """Large-order flag only. A factor row is read when it can change the flag."""
    if payload.order_type == "limit":
        notional = notional_amount(payload.quantity, payload.limit_price)
    else:
        uplift = _market_reference(quote, read_at)
        if uplift is None:
            return None
        notional = notional_amount(payload.quantity, uplift)
    if notional < settings.large_order_step_up_notional:
        return False
    if settings.mfa_required:
        return True
    return confirmed_factor(db, user_id) is not None


def _market_reference(quote: MarketQuoteCache | None, read_at: datetime) -> Decimal | None:
    """20% reference uplift after the snapshot quote passes the usability check."""
    if quote is None or _price_band_problem(quote, None, now=read_at) is not None:
        return None
    price = _finite_decimal(quote.price)
    if price is None or price <= 0:
        return None
    uplift = price * UPLIFT
    if not uplift.is_finite():
        return None
    return uplift


def _slice_copies(slices: list[tuple[Order, Decimal]]) -> list[dict]:
    copied = []
    for maker, quantity in slices:
        price = maker.limit_price
        copied.append({
            "order_id": maker.id,
            "user_id": maker.user_id,
            "quantity": Decimal(quantity),
            "price": None if price is None else Decimal(price),
            "remaining": Decimal(maker.remaining_quantity),
        })
    return copied


def _market_reservation(slices: list[dict]) -> Decimal | None:
    total = Decimal(0)
    for item in slices:
        quantity = item["quantity"]
        if not isinstance(quantity, Decimal) or not quantity.is_finite() or quantity < 0:
            raise ValueError("Invalid trade fill")
        price = item["price"]
        if not isinstance(price, Decimal) or not price.is_finite():
            return None
        try:
            total += notional_amount(quantity, price)
        except (ArithmeticError, TypeError, ValueError):
            return None
    return total


def _accounts(
    db: Session,
    owner_id: int,
    owner_cash: Decimal,
    owner_shares: Decimal,
    owner_reserved: Decimal,
    asset: Asset | None,
    slices: list[dict],
) -> tuple[
    dict[int, Decimal], dict[int, Decimal], dict[int, Decimal], dict[int, Decimal],
    tuple[set[int], set[int], set[int]],
]:
    """Scalar copies of cash, this-asset shares, and open-buy reservations."""
    cash = {owner_id: owner_cash}
    shares = {owner_id: owner_shares}
    reserved = {owner_id: owner_reserved}
    remaining = {item["order_id"]: item["remaining"] for item in slices if item["quantity"] > 0}
    bad_cash: set[int] = set()
    bad_shares: set[int] = set()
    bad_reserved: set[int] = set()
    maker_ids = {item["user_id"] for item in slices if item["quantity"] > 0 and item["user_id"] != owner_id}
    if not maker_ids:
        return cash, shares, reserved, remaining, (bad_cash, bad_shares, bad_reserved)

    rows = db.execute(select(User.id, User.cash_balance).where(User.id.in_(maker_ids))).all()
    found = {row[0] for row in rows}
    if found != maker_ids:
        missing = min(maker_ids - found)
        db.execute(select(User.id).where(User.id == missing)).scalar_one()
    for user_id, balance in rows:
        number = _finite_decimal(balance)
        if number is None:
            bad_cash.add(user_id)
            continue
        cash[user_id] = number

    if asset is not None:
        held_rows = db.execute(
            select(Holding.user_id, Holding.quantity).where(
                Holding.asset_id == asset.id, Holding.user_id.in_(maker_ids)
            )
        ).all()
        for user_id, quantity in held_rows:
            number = _finite_decimal(quantity)
            if number is None:
                bad_shares.add(user_id)
                continue
            shares[user_id] = number
    for user_id in maker_ids:
        if user_id not in bad_shares:
            shares.setdefault(user_id, Decimal(0))
        reserved.setdefault(user_id, Decimal(0))

    open_buys = db.execute(
        select(Order.id, Order.user_id, Order.remaining_quantity, Order.limit_price).where(
            Order.user_id.in_(maker_ids), Order.side == "buy", Order.status == "open"
        )
    ).all()
    for order_id, user_id, quantity, price in open_buys:
        if user_id in bad_reserved:
            continue
        qty = _finite_decimal(quantity)
        limit = _finite_decimal(price)
        if qty is None or limit is None:
            bad_reserved.add(user_id)
            reserved.pop(user_id, None)
            continue
        try:
            contribution = notional_amount(qty, limit)
        except (ArithmeticError, TypeError, ValueError):
            bad_reserved.add(user_id)
            reserved.pop(user_id, None)
            continue
        reserved[user_id] = reserved[user_id] + contribution
        remaining[order_id] = qty
    return cash, shares, reserved, remaining, (bad_cash, bad_shares, bad_reserved)


def _settle(
    payload: OrderCreate,
    owner_id: int,
    quote: MarketQuoteCache | None,
    read_at: datetime,
    slices: list[dict],
    cash: dict[int, Decimal],
    shares: dict[int, Decimal],
    reserved: dict[int, Decimal],
    remaining: dict[int, Decimal],
    bad: tuple[set[int], set[int], set[int]],
) -> tuple[str, str | None, Decimal, Decimal]:
    """Buy fill, then sell fill, on running scalar balances. Nothing is written."""
    incoming = payload.quantity
    limit_price = payload.limit_price
    if payload.side == "buy" and payload.order_type == "limit" and limit_price is not None:
        # Market orders are inserted canceled, so they do not join open-buy reservations.
        reserved[owner_id] = reserved[owner_id] + notional_amount(payload.quantity, limit_price)

    filled_quantity = Decimal(0)
    filled_notional = Decimal(0)
    bad_cash, bad_shares, bad_reserved = bad
    for item in slices:
        qty = item["quantity"]
        # execute_fill rejects non-positive quantity before any cash or share movement.
        if not isinstance(qty, Decimal) or not qty.is_finite() or qty <= 0 or qty > item["remaining"]:
            raise ValueError("Invalid trade fill")
        price = item["price"]
        if not isinstance(price, Decimal) or not price.is_finite():
            return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)
        problem = _price_band_problem(quote, price, now=read_at)
        if problem is not None:
            status, reason = _control(problem)
            return status, reason, Decimal(0), Decimal(0)
        try:
            notional = notional_amount(qty, price)
        except (ArithmeticError, TypeError, ValueError):
            return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)
        if notional <= 0:
            return "blocked", DUST, Decimal(0), Decimal(0)

        maker_id = item["user_id"]
        if payload.side == "buy":
            buyer_id, seller_id = owner_id, maker_id
        else:
            buyer_id, seller_id = maker_id, owner_id
        # Reservation totals matter only for the buyer. A seller's other bids are not this fill.
        if (
            buyer_id in bad_cash or seller_id in bad_cash
            or buyer_id in bad_shares or seller_id in bad_shares
            or buyer_id in bad_reserved
            or buyer_id not in cash or buyer_id not in reserved or buyer_id not in shares
            or seller_id not in shares or seller_id not in cash
        ):
            return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)
        if payload.side == "sell":
            previous = remaining.get(item["order_id"])
            if previous is None or qty > previous:
                return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)
        if notional > cash[buyer_id]:
            if buyer_id == owner_id:
                return "blocked", "Insufficient buying power", Decimal(0), Decimal(0)
            return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)
        if qty > shares[seller_id]:
            if seller_id == owner_id:
                return "blocked", "Not enough holdings to sell", Decimal(0), Decimal(0)
            return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)

        cash[buyer_id] -= notional
        cash[seller_id] += notional
        shares[seller_id] -= qty
        shares[buyer_id] += qty
        if payload.side == "buy" and payload.order_type == "limit" and limit_price is not None:
            previous_incoming = incoming
            incoming -= qty
            _replace_open_buy(reserved, owner_id, previous_incoming, incoming, limit_price)
        elif payload.side == "sell":
            previous = remaining[item["order_id"]]
            updated = previous - qty
            remaining[item["order_id"]] = updated
            _replace_open_buy(reserved, maker_id, previous, updated, price)
        if reserved[buyer_id] > cash[buyer_id]:
            if buyer_id == owner_id:
                return "blocked", "Insufficient buying power after matching", Decimal(0), Decimal(0)
            return "unavailable", LIQUIDITY, Decimal(0), Decimal(0)
        filled_quantity += qty
        filled_notional += notional
    return "eligible", None, filled_quantity, filled_notional


def _replace_open_buy(
    reserved: dict[int, Decimal], user_id: int, previous: Decimal, updated: Decimal, price: Decimal
) -> None:
    """Replace one open buy's cent-rounded contribution. A filled order contributes zero."""
    reserved[user_id] = reserved[user_id] + notional_amount(updated, price) - notional_amount(previous, price)


def _control(reason: str) -> tuple[str, str]:
    if reason.startswith("Usable"):
        return "unavailable", reason
    return "blocked", reason


def _finite_decimal(value: object) -> Decimal | None:
    try:
        number = Decimal(value)  # type: ignore[arg-type]
    except (ArithmeticError, TypeError, ValueError):
        return None
    if not number.is_finite():
        return None
    return number


def _required_decimal(value: object) -> Decimal:
    number = _finite_decimal(value)
    if number is None:
        raise ValueError("Unusable decimal in order preview")
    return number


def _money(value: Decimal) -> str:
    return format(value.quantize(CENT, rounding=ROUND_HALF_UP), "f")


def _quantity(value: Decimal) -> str:
    return format(value.quantize(SIX_PLACES, rounding=ROUND_HALF_UP), "f")


def _utc_z(value: datetime) -> str:
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat() + "Z"
