from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token
from app.models.aml import CashMovement
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.trading_halt import TradingHaltState
from app.models.user import LIQUIDITY_PROVIDER_IDENTITY, User
from app.scripts.reconcile_ledger import run as reconcile
from app.services import aml_cases, surveillance_cases
from app.services.aml_detect import detect as detect_aml
from app.services.aml_rules import load_rules as aml_rules
from app.services.cash_movements import post_movement
from app.services.eod_service import EodQuote, _latest_complete_daily_bar
from app.services.market_cache_service import refresh_quote_cache
from app.services.surveillance_detect import detect as detect_surveillance
from app.services.surveillance_rules import load_rules as surveillance_rules
from app.services.trade_execution import reserved_cash


# AAPL raw Yahoo daily bars. Prices are rounded to the cache's six-place precision.
QUOTES = [
    EodQuote("AAPL", date(2026, 11, 13), Decimal("357.959991"), Decimal("360.829987"),
             Decimal("355.750000"), Decimal("356.269989"), 40027500),
    EodQuote("AAPL", date(2026, 11, 16), Decimal("357.130005"), Decimal("357.130005"),
             Decimal("351.309998"), Decimal("352.779999"), 50292200),
    EodQuote("AAPL", date(2026, 11, 17), Decimal("352.829987"), Decimal("355.359985"),
             Decimal("349.670013"), Decimal("351.910004"), 37341600),
]
CLOCK = datetime(2026, 11, 18, 12)


@pytest.fixture
def refresh(db_session, monkeypatch):
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return CLOCK if tz is None else CLOCK.replace(tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(settings, "simulated_liquidity_enabled", True)
    monkeypatch.setattr("app.services.pretrade_controls.datetime", FrozenDatetime)
    monkeypatch.setattr("app.services.market_cache_service._utcnow", lambda: CLOCK)
    monkeypatch.setattr("app.services.order_preview.snapshot_clock", lambda db: CLOCK)
    db_session.add(MarketSymbol(symbol="AAPL", company_name="Apple Inc.", exchange="NASDAQ", is_active=True))
    db_session.commit()

    def run(quote):
        monkeypatch.setattr("app.services.market_cache_service.fetch_eod_batch", lambda symbols: {"AAPL": quote})
        result = refresh_quote_cache(db_session, "hot", 1, source="eod", symbols=["AAPL"])
        assert result["refreshed"] == 1 and result["errors"] == []

    return run


def _order(side="buy", quantity="1", limit=None):
    order = {"symbol": "AAPL", "side": side, "quantity": quantity}
    return {**order, "order_type": "market"} if limit is None else {**order, "limit_price": limit}


def _preview(client, headers, body):
    response = client.post("/orders/preview", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _place(client, headers, body, key=None):
    response = client.post("/orders/", headers={**headers, "Idempotency-Key": key or str(uuid4())}, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _detail(client, headers, order):
    response = client.get(f"/orders/{order['id']}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_solo_market_buy_sell_provenance_idempotency_and_ledger(client, auth_headers, db_session, refresh):
    headers = auth_headers("nora-wells@example.com")
    refresh(QUOTES[2])
    body = _order()
    preview = _preview(client, headers, body)
    assert preview["estimated_fill_notional"] == "351.91"
    assert preview["estimated_fills"] == [{
        "counterparty": "simulated", "quantity": "1.000000", "execution_price": "351.910004",
        "simulated_quote_date": "2026-11-17",
    }]
    assert preview["remainder_reason"] is None
    assert db_session.scalar(select(User.id).where(User.is_system)) is None
    assert db_session.scalar(select(Asset.id)) is None

    body["expected_quote_observed_at"] = preview["quote_observed_at"]
    key = str(uuid4())
    bought = _place(client, headers, body, key)
    assert bought["status"] == "filled"
    assert bought["simulated_quote_date"] == "2026-11-17"
    assert len(bought["trade_ids"]) == 2
    assert _place(client, headers, body, key) == bought
    detail = _detail(client, headers, bought)
    assert detail["total_fill_count"] == 1
    assert detail["fills"][0]["simulated_quote_date"] == bought["simulated_quote_date"]
    assert detail["fills"][0]["execution_price"] == "351.910004"
    assert client.get("/trades/", headers=headers).json()["trades"][0]["simulated_quote_date"] == "2026-11-17"

    sold = _place(client, headers, _order("sell"))
    assert sold["status"] == "filled"
    assert db_session.scalar(select(func.count(Trade.id))) == 4
    provider = db_session.scalar(select(User).where(User.is_system))
    assert provider.cash_balance == 0
    assert db_session.scalar(select(Holding.quantity).where(Holding.user_id == provider.id)) == 1
    assert reconcile(db_session)["failures"] == []
    assert client.post("/auth/login", data={"username": LIQUIDITY_PROVIDER_IDENTITY, "password": "!"}).status_code == 401
    system_token = create_access_token(provider.id)
    assert client.get("/trades/", headers={"Authorization": f"Bearer {system_token}"}).status_code == 401


def test_customer_price_time_priority_then_capped_simulated_market_remainder(
    client, auth_headers, db_session, refresh, monkeypatch,
):
    monkeypatch.setattr(settings, "simulated_liquidity_max_shares", 1)
    refresh(QUOTES[2])
    older = auth_headers("leon-vale@example.com")
    newer = auth_headers("iris-holt@example.com")
    buyer = auth_headers("mina-ash@example.com")
    _place(client, older, _order())
    _place(client, newer, _order())
    expensive = _place(client, older, _order("sell", limit="354"))
    cheaper = _place(client, newer, _order("sell", limit="353"))
    body = _order(quantity="4")
    preview = _preview(client, buyer, body)
    assert [(fill["counterparty"], fill["execution_price"]) for fill in preview["estimated_fills"]] == [
        ("user", "353.000000"), ("user", "354.000000"), ("simulated", "351.910004"),
    ]
    assert preview["initial_reservation"] == preview["estimated_fill_notional"] == "1058.91"
    assert preview["unfilled_quantity"] == "1.000000"
    assert "will be canceled" in preview["remainder_reason"]

    submitted = _place(client, buyer, body)
    assert submitted["status"] == "canceled"
    detail = _detail(client, buyer, submitted)
    assert detail["remainder_reason"] == submitted["remainder_reason"]
    assert "were canceled" in detail["remainder_reason"]
    assert detail["filled_quantity"] == preview["estimated_fill_quantity"]
    assert [fill["execution_price"] for fill in detail["fills"]] == ["353.000000", "354.000000", "351.910004"]
    assert "simulated_quote_date" not in detail["fills"][0]
    assert _detail(client, older, expensive)["status"] == _detail(client, newer, cheaper)["status"] == "filled"
    assert reconcile(db_session)["failures"] == []


def test_crossing_close_sweeps_once_per_date_and_cancel_releases_remainder(
    client, auth_headers, db_session, refresh, monkeypatch,
):
    headers = auth_headers("elena-grove@example.com")
    monkeypatch.setattr(settings, "simulated_liquidity_max_shares", 1)
    refresh(QUOTES[0])
    body = _order(quantity="2.5", limit="353")
    preview = _preview(client, headers, body)
    assert preview["estimated_fills"] == []
    assert "has not reached" in preview["remainder_reason"]
    order = _place(client, headers, body)
    assert order["status"] == "open"
    assert order["remainder_reason"] == preview["remainder_reason"]

    refresh(QUOTES[1])
    refresh(QUOTES[1])
    refresh(QUOTES[0])
    db_session.expire_all()
    assert db_session.get(MarketQuoteCache, "AAPL").quote_at.date() == QUOTES[1].date
    detail = _detail(client, headers, order)
    assert detail["remaining_quantity"] == "1.500000"
    assert detail["total_fill_count"] == 1
    assert "share cap" in detail["remainder_reason"]

    refresh(QUOTES[2])
    detail = _detail(client, headers, order)
    assert detail["remaining_quantity"] == "0.500000"
    assert [fill["simulated_quote_date"] for fill in detail["fills"]] == ["2026-11-16", "2026-11-17"]
    assert detail["simulated_quote_date"] == "2026-11-17"
    owner_id = db_session.get(Order, order["id"]).user_id
    assert reserved_cash(db_session, owner_id) == Decimal("176.50")
    assert client.post(f"/orders/{order['id']}/cancel", headers=headers).status_code == 200
    assert reserved_cash(db_session, owner_id) == 0
    assert reconcile(db_session)["failures"] == []


def test_refresh_rechecks_halt_price_bands_and_position_limit_per_order(
    client, auth_headers, db_session, refresh, monkeypatch,
):
    refresh(QUOTES[0])
    blocked = auth_headers("dana-sloane@example.com")
    allowed = auth_headers("otto-reed@example.com")
    cap_order = _place(client, blocked, _order(quantity="2", limit="353"))
    fill_order = _place(client, allowed, _order(limit="353"))
    with monkeypatch.context() as legacy:
        legacy.setattr(settings, "simulated_liquidity_enabled", False)
        band_order = _place(client, blocked, _order(limit="427"))

    db_session.get(TradingHaltState, 1).halted = True
    db_session.commit()
    refresh(QUOTES[1])
    assert "halted" in _detail(client, blocked, cap_order)["remainder_reason"]
    assert _detail(client, allowed, fill_order)["filled_quantity"] == "0.000000"
    db_session.get(TradingHaltState, 1).halted = False
    db_session.commit()
    refresh(QUOTES[1])
    assert _detail(client, allowed, fill_order)["filled_quantity"] == "0.000000"

    monkeypatch.setattr(settings, "max_stock_position_notional", Decimal("500"))
    refresh(QUOTES[2])
    assert "position-size" in _detail(client, blocked, cap_order)["remainder_reason"]
    assert "reference band" in _detail(client, blocked, band_order)["remainder_reason"]
    assert _detail(client, allowed, fill_order)["status"] == "filled"


def test_disabled_keeps_book_only_behavior_and_never_creates_system_account(
    client, auth_headers, db_session, refresh, monkeypatch,
):
    headers = auth_headers("kate-hale@example.com")
    refresh(QUOTES[0])
    monkeypatch.setattr(settings, "simulated_liquidity_enabled", False)
    body = _order()
    preview = _preview(client, headers, body)
    assert preview["estimated_fill_quantity"] == "0.000000"
    assert "estimated_fills" not in preview and "remainder_reason" not in preview
    assert _place(client, headers, body)["status"] == "canceled"
    limit = _place(client, headers, _order(limit="353"))
    refresh(QUOTES[2])
    assert _detail(client, headers, limit)["filled_quantity"] == "0.000000"
    assert db_session.scalar(select(User.id).where(User.is_system)) is None


def test_simulated_market_orders_use_existing_cash_share_and_halt_controls(
    client, auth_headers, db_session, refresh,
):
    headers = auth_headers("lyra-perry@example.com")
    refresh(QUOTES[2])
    user = db_session.scalar(select(User).where(User.email == "lyra-perry@example.com"))
    post_movement(db_session, user, "withdrawal", Decimal("99700"), None)
    db_session.commit()
    for request, reason, status in [
        (_order(), "Insufficient buying power", 400),
        (_order("sell"), "Not enough holdings to sell", 400),
        (_order(limit="500"), "Order price outside the 20% reference band (SM-PT-02)", 400),
    ]:
        assert _preview(client, headers, request)["reason"] == reason
        response = client.post("/orders/", headers={**headers, "Idempotency-Key": str(uuid4())}, json=request)
        assert response.status_code == status
        assert response.json()["detail"] == reason
    db_session.get(TradingHaltState, 1).halted = True
    db_session.commit()
    assert "halted" in _preview(client, headers, _order())["reason"]
    halted = client.post("/orders/", headers={**headers, "Idempotency-Key": str(uuid4())}, json=_order())
    assert halted.status_code == 503
    assert db_session.scalar(select(User.id).where(User.is_system)) is None
    assert db_session.scalar(select(Trade.id)) is None
    assert db_session.scalar(select(Order.id)) is None
    assert reconcile(db_session)["failures"] == []


def test_sell_limit_sweeps_when_a_higher_close_reaches_it(client, auth_headers, db_session, refresh):
    headers = auth_headers("rowan-hay@example.com")
    earlier = EodQuote("AAPL", date(2026, 11, 12), Decimal("357.809998"), Decimal("359.369995"),
                       Decimal("354.410004"), Decimal("354.880005"), 31875000)
    refresh(earlier)
    _place(client, headers, _order())
    limit = _place(client, headers, _order("sell", limit="355"))
    assert "has not reached" in limit["remainder_reason"]
    refresh(QUOTES[0])
    detail = _detail(client, headers, limit)
    assert detail["status"] == "filled"
    assert detail["fills"][0]["simulated_quote_date"] == "2026-11-13"
    assert detail["fills"][0]["realized_pnl"] == "1.39"
    assert reconcile(db_session)["failures"] == []


def test_unconfirmed_yahoo_bar_waits_and_its_confirmed_close_can_sweep(
    client, auth_headers, db_session, refresh,
):
    headers = auth_headers("petra-lowe@example.com")
    refresh(QUOTES[0])
    cached = db_session.get(MarketQuoteCache, "AAPL")
    cached.fetched_at = datetime(2026, 11, 13, 18)
    db_session.commit()
    order = _place(client, headers, _order(limit="357"))
    assert order["remainder_reason"] == "Waiting for a confirmed end-of-day close."
    refresh(QUOTES[0])
    assert _detail(client, headers, order)["status"] == "filled"


def test_cash_issuance_and_detector_intake_exclude_the_system(client, auth_headers, db_session, refresh, monkeypatch):
    headers = auth_headers("jules-hale@example.com")
    refresh(QUOTES[2])
    monkeypatch.setattr("app.routers.trades.get_live_price", lambda *_: QUOTES[2].price)
    response = client.post("/trades/", headers={**headers, "Idempotency-Key": str(uuid4())},
                           json={"symbol": "AAPL", "side": "buy", "asset_type": "stock", "quantity": 2})
    assert response.status_code == 200
    _place(client, headers, _order("sell"))
    provider_id = db_session.scalar(select(User.id).where(User.is_system))
    issuance = db_session.scalars(select(LedgerEntry).where(
        LedgerEntry.user_id == provider_id, LedgerEntry.event_kind == "simulated_liquidity_issuance",
    ).order_by(LedgerEntry.id)).all()
    assert [(entry.account, entry.amount) for entry in issuance] == [
        ("cash", Decimal("351.91")), ("offset", Decimal("-351.91")),
    ]
    assert reconcile(db_session)["failures"] == []

    real = db_session.get(Trade, response.json()["trade_id"])
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for user_id in (provider_id, real.user_id):
        for offset in range(3):
            db_session.add(CashMovement(user_id=user_id, kind="deposit", amount=4000,
                                        created_at=now - timedelta(minutes=offset)))
    # Even unmarked operator/test records from the dedicated identity are excluded.
    db_session.add_all([
        Trade(user_id=provider_id, asset_id=real.asset_id, side="sell", quantity=real.quantity,
              price_at_execution=real.price_at_execution, executed_at=now),
        Order(user_id=provider_id, asset_id=real.asset_id, side="sell", order_type="limit",
              status="canceled", quantity=1000, remaining_quantity=1000, limit_price=QUOTES[2].price,
              created_at=now - timedelta(seconds=1), canceled_at=now),
    ])
    db_session.commit()
    since = now - timedelta(minutes=10)
    events = surveillance_cases.events_from_db(db_session, since)
    assert {event.user_id for event in events} == {real.user_id}
    assert [event.event_id for event in events if event.kind == "trade"] == [f"trade-{real.id}"]
    assert not detect_surveillance(surveillance_rules()["SM-SV-01"], events)
    assert not detect_surveillance(surveillance_rules()["SM-SV-02"], events)

    cash_events = aml_cases.events_from_db(db_session, since)
    assert {event.user_id for event in cash_events} == {real.user_id}
    assert {case.user_id for case in detect_aml(aml_rules()["SM-AML-01"], cash_events)} == {real.user_id}


def test_yahoo_reader_ignores_the_current_sessions_bar():
    payload = {"chart": {"result": [{
        "timestamp": [datetime.combine(quote.date, time(14, 30), timezone.utc).timestamp() for quote in QUOTES],
        "indicators": {"quote": [{
            field: [getattr(quote, field) for quote in QUOTES]
            for field in ("open", "high", "low", "close", "volume")
        }]},
    }]}}
    assert _latest_complete_daily_bar(payload, "AAPL", before_day=QUOTES[2].date) == QUOTES[1]
