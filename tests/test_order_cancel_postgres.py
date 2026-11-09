"""Cancel versus fill serialization on isolated CI PostgreSQL.

Skipped unless AUDIT_DATABASE_URL is set. Connections go through the preview
helper, which refuses a URL before connecting unless it is disposable.
"""

from datetime import datetime, timezone
from decimal import Decimal
import os
import threading
import time
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select, text

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.trading_halt import TradingHaltState
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.ledger_service import ensure_opening, reconcile_account
from app.services.order_book import cancel_order, place_order
from app.services.trade_execution import execute_fill, reserved_cash, reserved_shares
import tests.test_order_preview_postgres as h


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)

_ONE = Decimal("1")
_PRICE = Decimal("100")
_CASH = Decimal("100000.00")
_AFTER_BUY = Decimal("99900.00")
_RESERVE = Decimal("100.00")


def _limit(symbol: str, side: str) -> OrderCreate:
    return OrderCreate(
        symbol=symbol,
        side=side,
        order_type="limit",
        quantity=_ONE,
        limit_price=_PRICE,
    )


def _ledger_count(db, user_id: int) -> int:
    return int(
        db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == user_id))
    )


def _seed(sessions) -> dict:
    symbol = f"CX{uuid4().hex[:10].upper()}"
    observed = datetime.now(timezone.utc).replace(tzinfo=None)
    with sessions() as db:
        state = db.get(TradingHaltState, 1)
        if state is None:
            db.add(TradingHaltState(id=1, halted=False, reason="Isolated cancel-fill proof"))
        else:
            assert state.halted is False
        asset = Asset(symbol=symbol, asset_type="stock", name=symbol, is_active=True)
        seller = User(
            email=f"cancel-s-{uuid4().hex}@example.com",
            password_hash="fixture",
            cash_balance=_CASH,
        )
        buyer = User(
            email=f"cancel-b-{uuid4().hex}@example.com",
            password_hash="fixture",
            cash_balance=_CASH,
        )
        db.add_all([
            asset,
            seller,
            buyer,
            MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True),
        ])
        db.flush()
        db.add(MarketQuoteCache(
            symbol=symbol,
            price=_PRICE,
            change_amount=Decimal("0"),
            change_percent=Decimal("0"),
            volume=0,
            source="yahoo",
            quote_at=observed,
            fetched_at=observed,
        ))
        execute_fill(db, seller, asset, "buy", _ONE, _PRICE)
        ensure_opening(db, buyer)
        sell_order, _trade_ids = place_order(db, int(seller.id), _limit(symbol, "sell"))
        db.flush()
        seller_id = int(seller.id)
        buyer_id = int(buyer.id)
        seeded = {
            "symbol": symbol,
            "asset_id": int(asset.id),
            "seller_id": seller_id,
            "buyer_id": buyer_id,
            "sell_order_id": int(sell_order.id),
            "ledger_seller": _ledger_count(db, seller_id),
            "ledger_buyer": _ledger_count(db, buyer_id),
        }
        db.commit()
    return seeded


def _sql_text(statement) -> str:
    if isinstance(statement, str):
        return statement
    if isinstance(statement, (bytes, bytearray)):
        return statement.decode("utf-8", "replace")
    return ""


def _race(engine, sessions, holder_name: str, waiter_name: str, holder_work, waiter_work) -> dict:
    """Pause the holder after its MarketSymbol row lock. Prove the waiter with pg_blocking_pids."""
    holder_ready = threading.Event()
    release = threading.Event()
    paused = {"done": False}
    pids: dict[str, int] = {}
    pid_lock = threading.Lock()
    outcomes = {
        holder_name: {"value": None, "error": None},
        waiter_name: {"value": None, "error": None},
    }

    def _after_cursor(conn, cursor, statement, parameters, context, executemany):
        if threading.current_thread().name != holder_name or paused["done"]:
            return
        folded = _sql_text(statement).lower()
        if "market_symbols" not in folded or "for update" not in folded:
            return
        paused["done"] = True
        holder_ready.set()
        if not release.wait(12):
            raise AssertionError("holder was not released within 12s; refusing to continue the proof")

    def _worker(name: str, work):
        session = sessions()
        try:
            session.execute(text("SET LOCAL lock_timeout = '10s'"))
            session.execute(text("SET LOCAL statement_timeout = '15s'"))
            backend_pid = int(session.execute(text("SELECT pg_backend_pid()")).scalar_one())
            with pid_lock:
                pids[name] = backend_pid
            outcomes[name]["value"] = work(session)
            session.commit()
        except Exception as exc:
            session.rollback()
            outcomes[name]["error"] = exc
        finally:
            session.close()

    hooked = False
    threads: list[threading.Thread] = []
    blocked = False
    try:
        event.listen(engine, "after_cursor_execute", _after_cursor)
        hooked = True
        holder = threading.Thread(target=_worker, name=holder_name, args=(holder_name, holder_work), daemon=True)
        waiter = threading.Thread(target=_worker, name=waiter_name, args=(waiter_name, waiter_work), daemon=True)
        threads = [holder, waiter]
        holder.start()
        if not holder_ready.wait(8):
            raise AssertionError("holder did not acquire MarketSymbol FOR UPDATE")
        waiter.start()
        observer = sessions()
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                with pid_lock:
                    waiter_pid = pids.get(waiter_name)
                    holder_pid = pids.get(holder_name)
                if waiter_pid is not None and holder_pid is not None:
                    blockers = observer.execute(
                        text("SELECT pg_blocking_pids(:pid)"),
                        {"pid": waiter_pid},
                    ).scalar_one()
                    if holder_pid in {int(item) for item in (blockers or [])}:
                        blocked = True
                        break
                time.sleep(0.05)
        finally:
            observer.rollback()
            observer.close()
    finally:
        release.set()
        holder_ready.set()
        for thread in threads:
            if thread.ident is not None:
                thread.join(20)
        if hooked:
            event.remove(engine, "after_cursor_execute", _after_cursor)
        engine.dispose()
    alive = [thread.name for thread in threads if thread.ident is not None and thread.is_alive()]
    if alive:
        raise AssertionError("worker still running: " + ",".join(alive))
    return {"blocked": blocked, "outcomes": outcomes}


def _raise_unexpected(outcome: dict) -> None:
    error = outcome["error"]
    if error is not None:
        raise error


def _holding_qty(db, user_id: int, asset_id: int) -> Decimal:
    quantity = db.scalar(
        select(Holding.quantity).where(Holding.user_id == user_id, Holding.asset_id == asset_id)
    )
    if quantity is None:
        return Decimal("0")
    return quantity


def _trades_for(db, order_id: int) -> list[Trade]:
    return list(db.scalars(select(Trade).where(Trade.order_id == order_id)).all())


def test_fill_wins_then_cancel_reloads_and_rejects():
    engine, sessions = h._engine_and_sessions()
    try:
        seed = _seed(sessions)

        def fill(db):
            order, trade_ids = place_order(db, seed["buyer_id"], _limit(seed["symbol"], "buy"))
            return {
                "order_id": int(order.id),
                "status": order.status,
                "trade_ids": [int(item) for item in trade_ids],
            }

        def cancel(db):
            pinned = db.get(Order, seed["sell_order_id"])
            assert pinned is not None
            assert pinned.status == "open"
            assert pinned.remaining_quantity == _ONE
            return int(cancel_order(db, seed["seller_id"], seed["sell_order_id"]).id)

        result = _race(engine, sessions, "fill-holder", "cancel-waiter", fill, cancel)
    finally:
        engine.dispose()

    assert result["blocked"] is True
    filled = result["outcomes"]["fill-holder"]
    canceled = result["outcomes"]["cancel-waiter"]
    _raise_unexpected(filled)
    assert filled["value"]["status"] == "filled"
    assert len(filled["value"]["trade_ids"]) == 2
    error = canceled["error"]
    assert isinstance(error, HTTPException)
    assert error.status_code == 409
    buyer_order_id = filled["value"]["order_id"]

    read_engine, read_sessions = h._engine_and_sessions()
    try:
        with read_sessions() as db:
            sell = db.get(Order, seed["sell_order_id"])
            buy = db.get(Order, buyer_order_id)
            seller = db.get(User, seed["seller_id"])
            buyer = db.get(User, seed["buyer_id"])
            assert sell.status == "filled"
            assert sell.remaining_quantity == Decimal("0")
            assert sell.canceled_at is None
            assert buy.status == "filled"
            assert buy.remaining_quantity == Decimal("0")
            assert buy.canceled_at is None
            sell_trades = _trades_for(db, seed["sell_order_id"])
            buy_trades = _trades_for(db, buyer_order_id)
            assert len(sell_trades) == 1
            assert len(buy_trades) == 1
            assert sell_trades[0].side == "sell"
            assert buy_trades[0].side == "buy"
            assert sell_trades[0].quantity == _ONE
            assert buy_trades[0].quantity == _ONE
            assert sell_trades[0].price_at_execution == _PRICE
            assert buy_trades[0].price_at_execution == _PRICE
            assert seller.cash_balance == _CASH
            assert buyer.cash_balance == _AFTER_BUY
            assert _holding_qty(db, seed["seller_id"], seed["asset_id"]) == Decimal("0")
            assert _holding_qty(db, seed["buyer_id"], seed["asset_id"]) == _ONE
            assert reconcile_account(db, seller)["ok"] is True
            assert reconcile_account(db, buyer)["ok"] is True
    finally:
        read_engine.dispose()


def test_cancel_wins_then_limit_buy_rests_unfilled():
    engine, sessions = h._engine_and_sessions()
    try:
        seed = _seed(sessions)

        def cancel(db):
            order = cancel_order(db, seed["seller_id"], seed["sell_order_id"])
            return {"order_id": int(order.id), "status": order.status, "remaining": order.remaining_quantity}

        def buy(db):
            order, trade_ids = place_order(db, seed["buyer_id"], _limit(seed["symbol"], "buy"))
            return {
                "order_id": int(order.id),
                "status": order.status,
                "remaining": order.remaining_quantity,
                "trade_ids": [int(item) for item in trade_ids],
            }

        result = _race(engine, sessions, "cancel-holder", "buy-waiter", cancel, buy)
    finally:
        engine.dispose()

    assert result["blocked"] is True
    canceled = result["outcomes"]["cancel-holder"]
    bought = result["outcomes"]["buy-waiter"]
    _raise_unexpected(canceled)
    _raise_unexpected(bought)
    assert canceled["value"]["status"] == "canceled"
    assert canceled["value"]["remaining"] == _ONE
    assert bought["value"]["status"] == "open"
    assert bought["value"]["remaining"] == _ONE
    assert bought["value"]["trade_ids"] == []
    buyer_order_id = bought["value"]["order_id"]

    read_engine, read_sessions = h._engine_and_sessions()
    try:
        with read_sessions() as db:
            sell = db.get(Order, seed["sell_order_id"])
            buy = db.get(Order, buyer_order_id)
            seller = db.get(User, seed["seller_id"])
            buyer = db.get(User, seed["buyer_id"])
            assert sell.status == "canceled"
            assert sell.remaining_quantity == _ONE
            assert sell.canceled_at is not None
            assert buy.status == "open"
            assert buy.remaining_quantity == _ONE
            assert buy.order_type == "limit"
            assert _trades_for(db, seed["sell_order_id"]) == []
            assert _trades_for(db, buyer_order_id) == []
            assert seller.cash_balance == _AFTER_BUY
            assert buyer.cash_balance == _CASH
            assert _holding_qty(db, seed["seller_id"], seed["asset_id"]) == _ONE
            assert _holding_qty(db, seed["buyer_id"], seed["asset_id"]) == Decimal("0")
            assert reserved_shares(db, seed["seller_id"], seed["asset_id"]) == Decimal("0")
            assert reserved_cash(db, seed["buyer_id"]) == _RESERVE
            assert _ledger_count(db, seed["seller_id"]) == seed["ledger_seller"]
            assert _ledger_count(db, seed["buyer_id"]) == seed["ledger_buyer"]
            assert reconcile_account(db, seller)["ok"] is True
            assert reconcile_account(db, buyer)["ok"] is True
    finally:
        read_engine.dispose()
