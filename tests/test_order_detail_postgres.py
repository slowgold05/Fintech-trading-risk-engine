"""PostgreSQL proofs for read-only order detail.

Skipped unless AUDIT_DATABASE_URL is set. Every connection goes through
test_order_preview_postgres, which refuses the URL before connecting unless
it is local PostgreSQL for database ci_audit or p3b_preview and user
ci_audit or p3b_preview.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import re
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text

import tests.test_order_preview_postgres as h
import app.routers.orders as orders
from app.models.asset import Asset
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)

_MUTATION = re.compile(r"\b(INSERT|UPDATE|DELETE|FOR\s+UPDATE)\b", re.IGNORECASE)
_ORDER_SELECT = re.compile(r"\bselect\b[\s\S]*\bfrom\b[\s\S]*\borders\b", re.IGNORECASE)
_UTC_Z = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")


def _patch_snapshot_clock(monkeypatch, observations: list) -> None:
    real = orders.snapshot_clock

    def wrapped(db):
        isolation = db.execute(text("SHOW transaction_isolation")).scalar_one()
        read_only = db.execute(text("SHOW transaction_read_only")).scalar_one()
        observations.append((str(isolation).strip().lower(), str(read_only).strip().lower()))
        return real(db)

    monkeypatch.setattr(orders, "snapshot_clock", wrapped)


def _read_detail(db, user_id: int, order_id: int) -> dict:
    # Direct call: Query and Depends defaults are not applied outside FastAPI.
    return orders.get_order_detail(
        db=db,
        current_user=SimpleNamespace(id=user_id),
        order_id=order_id,
        limit=50,
        after_id=None,
    )


def _without_read_at(body: dict) -> dict:
    return {key: value for key, value in body.items() if key != "read_at"}


def _assert_recent_utc_z(value: str, started: datetime, finished: datetime) -> None:
    assert _UTC_Z.fullmatch(value)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert started - timedelta(minutes=2) <= parsed <= finished + timedelta(minutes=2)


def _seed_order(sessions, *, quantity, remaining, limit_price, created_at, fill=None) -> dict:
    symbol = f"OD{uuid4().hex[:12].upper()}"
    email = f"detail-{uuid4().hex}@example.com"
    with sessions() as seed:
        user = User(email=email, password_hash="fixture", cash_balance=Decimal("0.00"))
        asset = Asset(symbol=symbol, asset_type="stock", name="Order detail", is_active=True)
        seed.add_all([user, asset])
        seed.flush()
        order = Order(
            user_id=user.id,
            asset_id=asset.id,
            side="buy",
            order_type="limit",
            quantity=quantity,
            remaining_quantity=remaining,
            limit_price=limit_price,
            status="open",
            created_at=created_at,
        )
        seed.add(order)
        seed.flush()
        trade_id = None
        if fill is not None:
            trade = Trade(
                user_id=user.id,
                asset_id=asset.id,
                order_id=order.id,
                side="buy",
                quantity=fill["quantity"],
                price_at_execution=fill["price"],
                realized_pnl=fill["realized_pnl"],
                realized_pnl_pct=Decimal("0"),
                executed_at=fill["executed_at"],
            )
            seed.add(trade)
            seed.flush()
            trade_id = int(trade.id)
        seeded = {
            "user_id": int(user.id),
            "asset_id": int(asset.id),
            "order_id": int(order.id),
            "symbol": symbol,
            "trade_id": trade_id,
        }
        seed.commit()
    return seeded


def test_order_detail_is_repeatable_read_only_without_side_effects(monkeypatch):
    engine, sessions = h._engine_and_sessions()
    try:
        created_at = datetime(2026, 3, 15, 12, 30, 45)
        executed_at = datetime(2026, 3, 15, 12, 31, 0)
        # Numeric(18, 6) boundary that SQLite cannot store exactly.
        seeded = _seed_order(
            sessions,
            quantity=Decimal("123456789012.345678"),
            remaining=Decimal("0.000001"),
            limit_price=Decimal("999999999999.999999"),
            created_at=created_at,
            fill={
                "quantity": Decimal("123456789012.345677"),
                "price": Decimal("1.000000"),
                "realized_pnl": Decimal("0.00"),
                "executed_at": executed_at,
            },
        )
        with sessions() as look:
            before_sequences = h._sequence_state(look)
            before_counts = h._table_counts(look)
        observations = []
        _patch_snapshot_clock(monkeypatch, observations)
        saw_mutation = False

        def guard(_conn, _cursor, statement, _parameters, _context, _executemany):
            nonlocal saw_mutation
            if _MUTATION.search(h._sql_text(statement)):
                saw_mutation = True
                raise RuntimeError("order detail read attempted a mutating statement")

        event.listen(engine, "before_cursor_execute", guard)
        try:
            started = datetime.now(timezone.utc)
            with sessions() as reader:
                body = _read_detail(reader, seeded["user_id"], seeded["order_id"])
            finished = datetime.now(timezone.utc)
        finally:
            event.remove(engine, "before_cursor_execute", guard)

        assert saw_mutation is False
        assert observations == [("repeatable read", "on")]
        assert _without_read_at(body) == {
            "order_id": seeded["order_id"],
            "symbol": seeded["symbol"],
            "side": "buy",
            "order_type": "limit",
            "status": "open",
            "quantity": "123456789012.345678",
            "filled_quantity": "123456789012.345677",
            "remaining_quantity": "0.000001",
            "limit_price": "999999999999.999999",
            "currency": "USD",
            "created_at": "2026-03-15T12:30:45Z",
            "canceled_at": None,
            "total_fill_count": 1,
            "limit": 50,
            "has_more": False,
            "next_after_id": None,
            "fills": [
                {
                    "trade_id": seeded["trade_id"],
                    "quantity": "123456789012.345677",
                    "execution_price": "1.000000",
                    "notional": "123456789012.35",
                    "realized_pnl": "0.00",
                    "executed_at": "2026-03-15T12:31:00Z",
                }
            ],
        }
        _assert_recent_utc_z(body["read_at"], started, finished)
        with sessions() as look:
            assert h._sequence_state(look) == before_sequences
            assert h._table_counts(look) == before_counts
    finally:
        engine.dispose()


def test_order_detail_hides_a_fill_committed_after_the_order_read():
    engine, sessions = h._engine_and_sessions()
    try:
        created_at = datetime(2026, 4, 2, 8, 0, 0)
        executed_at = datetime(2026, 4, 2, 8, 5, 1)
        seeded = _seed_order(
            sessions,
            quantity=Decimal("3"),
            remaining=Decimal("3"),
            limit_price=Decimal("20"),
            created_at=created_at,
        )
        recorded = {"trade_id": None}
        triggered = False

        def after_order_select(_conn, _cursor, statement, _parameters, _context, _executemany):
            nonlocal triggered
            if triggered or _ORDER_SELECT.search(h._sql_text(statement)) is None:
                return
            # Set the flag before the writer so its SELECT/INSERT cannot re-enter.
            # The commit falls between the order SELECT and the fill count/page.
            triggered = True
            with sessions() as writer:
                order = writer.get(Order, seeded["order_id"])
                order.remaining_quantity = Decimal("2")
                trade = Trade(
                    user_id=seeded["user_id"],
                    asset_id=seeded["asset_id"],
                    order_id=seeded["order_id"],
                    side="buy",
                    quantity=Decimal("1"),
                    price_at_execution=Decimal("10.005"),
                    realized_pnl=Decimal("0.00"),
                    realized_pnl_pct=Decimal("0"),
                    executed_at=executed_at,
                )
                writer.add(trade)
                writer.flush()
                recorded["trade_id"] = int(trade.id)
                writer.commit()

        event.listen(engine, "after_cursor_execute", after_order_select)
        try:
            with sessions() as reader:
                during = _read_detail(reader, seeded["user_id"], seeded["order_id"])
        finally:
            event.remove(engine, "after_cursor_execute", after_order_select)

        assert triggered is True
        assert _UTC_Z.fullmatch(during["read_at"])
        assert _without_read_at(during) == {
            "order_id": seeded["order_id"],
            "symbol": seeded["symbol"],
            "side": "buy",
            "order_type": "limit",
            "status": "open",
            "quantity": "3.000000",
            "filled_quantity": "0.000000",
            "remaining_quantity": "3.000000",
            "limit_price": "20.000000",
            "currency": "USD",
            "created_at": "2026-04-02T08:00:00Z",
            "canceled_at": None,
            "total_fill_count": 0,
            "limit": 50,
            "has_more": False,
            "next_after_id": None,
            "fills": [],
        }
        with sessions() as later:
            follow = _read_detail(later, seeded["user_id"], seeded["order_id"])
        assert _UTC_Z.fullmatch(follow["read_at"])
        assert _without_read_at(follow) == {
            "order_id": seeded["order_id"],
            "symbol": seeded["symbol"],
            "side": "buy",
            "order_type": "limit",
            "status": "open",
            "quantity": "3.000000",
            "filled_quantity": "1.000000",
            "remaining_quantity": "2.000000",
            "limit_price": "20.000000",
            "currency": "USD",
            "created_at": "2026-04-02T08:00:00Z",
            "canceled_at": None,
            "total_fill_count": 1,
            "limit": 50,
            "has_more": False,
            "next_after_id": None,
            "fills": [
                {
                    "trade_id": recorded["trade_id"],
                    "quantity": "1.000000",
                    "execution_price": "10.005000",
                    "notional": "10.01",
                    "realized_pnl": "0.00",
                    "executed_at": "2026-04-02T08:05:01Z",
                }
            ],
        }
    finally:
        engine.dispose()
