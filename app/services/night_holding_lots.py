import base64
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP, localcontext
import hmac
import json

from sqlalchemy import Numeric, and_, case, func, null, select, tuple_, type_coerce
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.lot import Lot
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.schemas.night_holding_lots import HoldingLots, LotRow, Mark, MarkSource, Page, SaleRow
from app.services.ledger_service import trade_in_current_book
from app.services.portfolio_valuation import _quote_state


ZERO = Decimal(0)
CENT = Decimal("0.01")
CursorKey = tuple[datetime, int]


class IneligibleHolding(Exception):
    pass


class InvalidHoldingCursor(Exception):
    def __init__(self, field: str):
        self.field = field


def _money(value: Decimal) -> str:
    rounded = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return format(abs(rounded) if rounded == 0 else rounded, ".2f")


def _units(value: Decimal) -> str:
    return format(value, ".6f").rstrip("0").rstrip(".")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class _CursorScope:
    owner_id: int
    symbol: str
    field: str

    def _signature(self, payload: bytes) -> bytes:
        scope = json.dumps(["holding-v1", self.owner_id, self.symbol, self.field]).encode()
        return hmac.digest(settings.jwt_secret.encode(), scope + b"\0" + payload, "sha256")

    def encode(self, timestamp: datetime, row_id: int) -> str:
        payload = json.dumps([timestamp.isoformat(), row_id], separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(payload + self._signature(payload)).decode().rstrip("=")

    def decode(self, token: str | None) -> CursorKey | None:
        if token is None:
            return None
        try:
            raw = base64.b64decode(token + "=" * (-len(token) % 4), altchars=b"-_", validate=True)
            payload, signature = raw[:-32], raw[-32:]
            if not hmac.compare_digest(signature, self._signature(payload)):
                raise ValueError
            timestamp, row_id = json.loads(payload)
            key = datetime.fromisoformat(timestamp), row_id
            if key[0].tzinfo is not None or type(row_id) is not int or row_id <= 0:
                raise ValueError
            if self.encode(*key) != token:
                raise ValueError
            return key
        except (TypeError, ValueError):
            raise InvalidHoldingCursor(self.field) from None


def _position_snapshot(db: Session, owner_id: int, symbol: str):
    return db.execute(
        select(
            Asset.id.label("asset_id"), Asset.asset_type, Holding.quantity,
            MarketQuoteCache.price.label("quote_price"), MarketQuoteCache.source.label("quote_source"),
            MarketQuoteCache.quote_at, MarketQuoteCache.fetched_at, MarketSymbol.refresh_tier,
        )
        .outerjoin(Holding, and_(Holding.user_id == owner_id, Holding.asset_id == Asset.id))
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == Asset.symbol)
        .outerjoin(MarketSymbol, MarketSymbol.symbol == Asset.symbol)
        .where(Asset.symbol == symbol)
    ).one_or_none()


def _book_start(db: Session, owner_id: int) -> date | None:
    # Latest reset takes precedence over the first opening snapshot. Restored demo
    # books use their historical effective date even though the reset just posted.
    row = db.execute(
        select(LedgerEntry.effective_on, LedgerEntry.created_at)
        .where(LedgerEntry.user_id == owner_id, LedgerEntry.event_kind.in_(("opening_snapshot", "reset")))
        .order_by(case((LedgerEntry.event_kind == "reset", -LedgerEntry.id), else_=LedgerEntry.id))
        .limit(1)
    ).one_or_none()
    return (row.effective_on or row.created_at.date()) if row is not None else None


def _mark(position, clock: datetime) -> tuple[Mark | None, bool]:
    quote = _quote_state(position, clock)
    if quote["price"] is None:
        return None, quote["unavailable_reason"] == "stale" and position.quote_at is not None
    # quote_at stores the source's session date for raw end-of-day quotes.
    observed = _utc(position.quote_at)
    return Mark(price=_units(quote["price"]), source=MarkSource(
        provider=position.quote_source, session_date=observed.date(), observed_at=observed,
    )), False


def _posted_sales(owner_id: int, asset_id: int):
    # A legacy trade without the owner's posted cash leg is outside this view.
    return (
        select(Trade.id.label("trade_id"), func.sum(LedgerEntry.amount).label("proceeds"))
        .join(LedgerEntry, and_(LedgerEntry.trade_id == Trade.id, LedgerEntry.user_id == owner_id))
        .where(
            Trade.user_id == owner_id, Trade.asset_id == asset_id, Trade.side == "sell",
            LedgerEntry.event_kind == "trade", LedgerEntry.account == "cash",
            LedgerEntry.unit == "USD", LedgerEntry.asset_id.is_(None),
            trade_in_current_book(owner_id, Trade.id),
        )
        .group_by(Trade.id)
        .subquery()
    )


def _sales_page(db: Session, posted, scope: _CursorScope, after: CursorKey | None, limit: int) -> Page[SaleRow]:
    query = (
        select(Trade, posted.c.proceeds, Order.id.label("owned_order_id"))
        .join(posted, posted.c.trade_id == Trade.id)
        .outerjoin(Order, and_(Order.id == Trade.order_id, Order.user_id == Trade.user_id,
                              Order.asset_id == Trade.asset_id))
        .order_by(Trade.executed_at.desc(), Trade.id.desc())
        .limit(limit + 1)
    )
    if after is not None:
        query = query.where(tuple_(Trade.executed_at, Trade.id) < after)
    rows = db.execute(query).all()
    items = [SaleRow(
        trade_id=trade.id, order_id=order_id, executed_at=_utc(trade.executed_at),
        quantity=_units(trade.quantity), fill_price=_units(trade.price_at_execution),
        proceeds_usd=_money(proceeds), realized_pnl_usd=_money(trade.realized_pnl), demo_seed=trade.demo_seed,
    ) for trade, proceeds, order_id in rows[:limit]]
    last = rows[limit - 1][0] if len(rows) > limit else None
    return Page(items=items, next_cursor=scope.encode(last.executed_at, last.id) if last else None)


def _lot_totals(db: Session, lot_scope, mark_price: Decimal | None):
    basis = type_coerce(Lot.qty_remaining * Lot.cost_per_unit, Numeric(38, 12))
    # Compare the displayed row sums with the once-rounded book totals.
    display_basis = type_coerce(func.round(basis, 2), Numeric(38, 2))
    display_pnl = null()
    if mark_price is not None:
        pnl = Lot.qty_remaining * (mark_price - Lot.cost_per_unit)
        display_pnl = func.sum(type_coerce(func.round(pnl, 2), Numeric(38, 2)))
    return db.execute(select(
        func.coalesce(func.sum(Lot.qty_remaining), 0), func.coalesce(func.sum(basis), 0),
        func.coalesce(func.sum(display_basis), 0), display_pnl,
    ).where(*lot_scope)).one()


def _lots_page(
    db: Session, lot_scope, scope: _CursorScope, after: CursorKey | None, limit: int, mark_price: Decimal | None,
) -> Page[LotRow]:
    query = select(Lot).where(*lot_scope).order_by(Lot.created_at, Lot.id).limit(limit + 1)
    if after is not None:
        query = query.where(tuple_(Lot.created_at, Lot.id) > after)
    rows = db.scalars(query).all()
    items = [LotRow(
        id=lot.id, recorded_at=_utc(lot.created_at), quantity_remaining=_units(lot.qty_remaining),
        cost_per_share=_units(lot.cost_per_unit), cost_basis_usd=_money(lot.qty_remaining * lot.cost_per_unit),
        unrealized_pnl_usd=_money(lot.qty_remaining * (mark_price - lot.cost_per_unit)) if mark_price is not None else None,
    ) for lot in rows[:limit]]
    last = rows[limit - 1] if len(rows) > limit else None
    return Page(items=items, next_cursor=scope.encode(last.created_at, last.id) if last else None)


def read_holding_lots(
    db: Session, owner_id: int, symbol: str, lot_cursor: str | None, sale_cursor: str | None, limit: int,
) -> HoldingLots:
    lot_key = _CursorScope(owner_id, symbol, "lot_cursor")
    sale_key = _CursorScope(owner_id, symbol, "sale_cursor")
    after_lot, after_sale = lot_key.decode(lot_cursor), sale_key.decode(sale_cursor)

    with consistent_read(db), localcontext() as decimals:
        decimals.prec = 50
        clock = snapshot_clock(db)
        position = _position_snapshot(db, owner_id, symbol)
        if position is None:
            raise IneligibleHolding
        posted = _posted_sales(owner_id, position.asset_id)
        sale_count, realized = db.execute(
            select(func.count(), func.sum(Trade.realized_pnl)).join(posted, posted.c.trade_id == Trade.id)
        ).one()
        if position.quantity is None and sale_count == 0:
            raise IneligibleHolding

        quantity = position.quantity if position.quantity is not None else ZERO
        mark, stale = _mark(position, clock)
        mark_price = position.quote_price if mark is not None else None
        lot_scope = (Lot.user_id == owner_id, Lot.asset_id == position.asset_id, Lot.qty_remaining > 0)
        lot_quantity, lot_basis, display_basis, display_pnl = _lot_totals(db, lot_scope, mark_price)
        basis_supported = lot_quantity == quantity
        market_value = quantity * mark_price if mark_price is not None else None
        if quantity == 0:
            market_value = ZERO
        unrealized = market_value - lot_basis if basis_supported and market_value is not None else None
        reported_basis = _money(lot_basis) if basis_supported else None
        reported_pnl = _money(unrealized) if unrealized is not None else None

        coverage, reason = "available", None
        if not basis_supported:
            coverage, reason = "partial", "Remaining FIFO lot quantity does not match the holding. Open cost basis and unrealized P&L are unavailable."
        elif quantity > 0 and mark is None:
            coverage = "stale" if stale else "missing"
            reason = "The cached portfolio mark is stale." if stale else "No usable cached portfolio mark is available."
        if basis_supported and (
            _money(display_basis) != reported_basis
            or (display_pnl is not None and _money(display_pnl) != reported_pnl)
        ):
            rounding = "Book totals are rounded after summing unrounded lot values, so displayed rows may sum differently."
            reason = f"{reason} {rounding}" if reason else rounding

        return HoldingLots(
            symbol=symbol, read_at=_utc(clock), book_started_on=_book_start(db, owner_id), coverage=coverage,
            quantity=_units(quantity), cost_basis_usd=reported_basis,
            market_value_usd=_money(market_value) if market_value is not None else None,
            unrealized_pnl_usd=reported_pnl,
            realized_pnl_usd=_money(realized or ZERO), mark=mark, reason=reason,
            lots=_lots_page(db, lot_scope, lot_key, after_lot, limit, mark_price),
            sales=_sales_page(db, posted, sale_key, after_sale, limit),
        )
