from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, update

from app.core.config import settings
from app.core.rate_limit import limiter
from app.models.asset import Asset
from app.models.ledger_entry import LedgerEntry
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.price_history_daily import PriceHistoryDaily
from app.models.refresh_token import RefreshToken
from app.models.trade import Trade
from app.models.user import User
from app.scripts.archive_demo_accounts import archive_expired
from app.services import demo_accounts
from app.services.ledger_service import reconcile_account


SESSIONS = ("2026-05-20", "2026-05-21", "2026-09-15", "2026-09-16", "2026-11-16", "2026-11-17")
# A small extract of stored Yahoo closes. Only the close is used by these paths.
CLOSES = {
    "AAPL": ("302.250000", "304.989990", "331.339996", "332.410004", "352.779999", "351.910004"),
    "JNJ": ("229.320007", "231.729996", "267.200012", "267.279999", "282.549988", "278.700012"),
    "SPY": ("741.250000", "742.719971", "757.390015", "754.049988", "739.950012", "732.440002"),
}


def _symbol(db, symbol, sector="Technology"):
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NYSE", sector=sector, refresh_tier="hot"))
    db.flush()


def _quote(db, symbol, price, now):
    db.add(MarketQuoteCache(symbol=symbol, price=Decimal(price), source="yahoo",
                            quote_at=now - timedelta(hours=1), fetched_at=now - timedelta(minutes=5)))


def _start(client):
    response = client.post("/auth/demo")
    assert response.status_code == 200, response.text
    session = response.json()
    return session, {"Authorization": f"Bearer {session['access_token']}"}


@pytest.fixture
def historical_market(db_session, monkeypatch):
    now = datetime(2026, 11, 18, 20)
    monkeypatch.setattr(demo_accounts, "_utc_now", lambda: now)
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: now)
    monkeypatch.setattr(demo_accounts, "PLANS", [demo_accounts.PLANS[1]])
    for symbol, values in CLOSES.items():
        _symbol(db_session, symbol, "Health Care" if symbol == "JNJ" else "Technology")
        _quote(db_session, symbol, values[-1], now)
        for stamp, price in zip(SESSIONS, values, strict=True):
            day = date.fromisoformat(stamp)
            # Cover a canonical split-adjusted provider and the older daily cache.
            if symbol == "JNJ":
                db_session.add(PriceHistoryDaily(symbol=symbol, date=day, source="yahoo",
                                                 open=price, high=price, low=price, close=price))
            else:
                db_session.add(MarketBarDaily(
                    symbol=symbol, session_date=day, provider="yahoo", adjustment_type="split_adjusted",
                    open=price, high=price, low=price, close=price, volume=1000,
                    fetched_at=now.replace(tzinfo=timezone.utc), quality_status="valid",
                ))
    # An otherwise eligible quote cannot substitute for missing history.
    _symbol(db_session, "AMZN")
    _quote(db_session, "AMZN", "254.00", now)
    db_session.commit()
    return now


def test_historical_demo_uses_stored_closes_and_feeds_analytics(client, db_session, historical_market):
    session, headers = _start(client)
    assert session["is_demo"] and session["demo_seed_mode"] == "historical"
    assert client.cookies.get("refresh_token")
    assert client.post("/auth/refresh").status_code == 200
    me = client.get("/auth/me", headers=headers).json()
    assert me["email"].endswith("@example.com") and me["role"] == "trader"
    assert me["is_demo"] and me["display_name"] == session["display_name"]
    assert client.get("/compliance/role-requests", headers=headers).status_code == 403
    trades = client.get("/trades/", headers=headers).json()["trades"]
    assert {trade["symbol"] for trade in trades} == {"AAPL", "JNJ"}
    assert len(trades) == 4 and sum(trade["side"] == "sell" for trade in trades) == 2
    for trade in trades:
        day = trade["executed_at"][:10]
        stored = CLOSES[trade["symbol"]][SESSIONS.index(day)]
        assert trade["demo_seed"] and Decimal(str(trade["price_at_execution"])) == Decimal(stored)
        assert trade["seed_price"]["provider"] == "yahoo"
    user = db_session.get(User, me["id"])
    assert reconcile_account(db_session, user) == {"ok": True, "entries": 18, "errors": []}
    seed_entry = db_session.scalar(select(LedgerEntry).where(LedgerEntry.trade_id == trades[0]["id"]))
    assert seed_entry.effective_on == date.fromisoformat(trades[0]["executed_at"][:10])
    assert seed_entry.created_at.date() > seed_entry.effective_on
    performance = client.get("/portfolio/performance?range=1y", headers=headers).json()
    assert performance["series"][0]["account_value"] == "100000.00"
    assert performance["demo_price_series"]["AAPL"]["adjustment"] == "split_adjusted"
    assert performance["demo_price_series"]["JNJ"]["adjustment"] == "legacy"
    assert any(point["daily_pnl"] not in (None, "0.00") for point in performance["series"])
    risk = client.get("/portfolio/risk-metrics?range=1y", headers=headers).json()
    assert risk["historical_volatility_pct"] is not None
    assert risk["correlations"][0]["correlation"] is not None
    assert client.get("/portfolio/allocation", headers=headers).json()["status"] == "complete"
    assert client.get("/portfolio/attribution", headers=headers).json()["status"] == "complete"


def test_demo_reset_replays_original_seed_after_a_trade(client, db_session, historical_market):
    _, headers = _start(client)
    original = client.get("/portfolio/performance?range=1y", headers=headers).json()
    prior = client.get("/portfolio/", headers=headers).json()
    params = {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}
    posted = client.post("/trades/", json=params, headers={**headers, "Idempotency-Key": "practice-buy"})
    assert posted.status_code == 200, posted.text
    user = db_session.scalar(select(User))
    original_seed = user.demo_seed
    reset_headers = {**headers, "Idempotency-Key": "restore-demo"}
    reset = client.post("/portfolio/reset", headers=reset_headers)
    assert reset.status_code == 200, reset.text
    assert reset.json()["cash_balance"] == prior["summary"]["cash_balance"]
    assert client.post("/portfolio/reset", headers=reset_headers).json() == reset.json()
    assert client.post("/portfolio/reset", headers=headers).json() == reset.json()
    assert user.demo_seed == original_seed
    assert db_session.get(Trade, posted.json()["trade_id"]).demo_seed is False
    assert db_session.query(Trade).count() == 9
    assert len(client.get("/trades/", headers=headers).json()["trades"]) == 4
    assessments = client.get("/risk/", headers=headers).json()["assessments"]
    assert len(assessments) == 4 and all(item["trade"]["demo_seed"] for item in assessments)
    restored = client.get("/portfolio/performance?range=1y", headers=headers).json()
    assert restored["series"] == original["series"]
    assert client.get("/portfolio/", headers=headers).json()["positions"] == prior["positions"]
    assert reconcile_account(db_session, user)["ok"]
    db_session.execute(update(LedgerEntry).where(LedgerEntry.id == 1)
                       .values(effective_on=date(2025, 1, 1)))
    db_session.commit()
    assert "Hash chain mismatch at entry 1" in reconcile_account(db_session, user)["errors"]


def test_no_bars_uses_only_stored_quotes_and_rotates_plans(client, db_session):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for symbol, price in {"AAPL": "351.910004", "JNJ": "278.700012", "MSFT": "506.239990", "XOM": "167.210007"}.items():
        _symbol(db_session, symbol)
        _quote(db_session, symbol, price, now)
    db_session.commit()
    first, first_headers = _start(client)
    second, second_headers = _start(client)
    assert first["demo_seed_mode"] == second["demo_seed_mode"] == "cached_quotes"
    assert first["display_name"] != second["display_name"]
    assert "cached quotes" in first["message"]
    books = []
    for headers in (first_headers, second_headers):
        trades = client.get("/trades/", headers=headers).json()["trades"]
        assert len(trades) == 3
        books.append({trade["symbol"] for trade in trades})
        for trade in trades:
            assert trade["executed_at"][:10] == now.date().isoformat()
            assert trade["seed_price"]["adjustment"] == "cached_quote"
            assert Decimal(str(trade["price_at_execution"])) == db_session.get(MarketQuoteCache, trade["symbol"]).price
    assert books[0] != books[1]
    assert len(set(db_session.scalars(select(User.email)))) == 2


def test_demo_signup_caps_origin_and_work(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "demo_daily_limit", 1)
    denied = client.post("/auth/demo", headers={"Origin": "https://untrusted.example"})
    assert denied.status_code == 403
    session, headers = _start(client)
    assert session["demo_seed_mode"] == "cash_only"
    assert client.get("/portfolio/", headers=headers).json()["summary"]["cash_balance"] == 100000
    assert client.post("/auth/demo").status_code == 429
    assert db_session.query(User).count() == 1


def test_demo_route_is_rate_limited(client, db_session, monkeypatch):
    limiter.reset()
    monkeypatch.setattr(limiter, "enabled", True)
    try:
        for _ in range(5):
            _start(client)
        assert client.post("/auth/demo").status_code == 429
        assert db_session.query(User).count() == 5
    finally:
        limiter.reset()


def test_failure_rolls_back_the_whole_demo(client, db_session, historical_market, monkeypatch):
    fill = demo_accounts.execute_fill

    def fail_after_fill(*args, **kwargs):
        fill(*args, **kwargs)
        raise RuntimeError("seed failed")

    monkeypatch.setattr(demo_accounts, "execute_fill", fail_after_fill)
    with pytest.raises(RuntimeError, match="seed failed"):
        client.post("/auth/demo")
    for model in (User, Trade, LedgerEntry, Asset, RefreshToken):
        assert db_session.query(model).count() == 0


def test_archive_revokes_access_and_preserves_audit_records(client, db_session, make_user, historical_market):
    _, headers = _start(client)
    demo = db_session.scalar(select(User))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    regular = db_session.get(User, make_user("ordinary@example.com")["id"])
    for user in (demo, regular):
        user.created_at = now - timedelta(days=9)
    asset = db_session.scalar(select(Asset))
    order = Order(user_id=demo.id, asset_id=asset.id, side="buy", quantity=Decimal(1),
                  remaining_quantity=Decimal(1), limit_price=Decimal("302.25"))
    db_session.add(order)
    db_session.commit()
    entry_count = db_session.query(LedgerEntry).filter_by(user_id=demo.id).count()
    assert client.post("/portfolio/reset", headers=headers).status_code == 400
    assert archive_expired(db_session, cutoff=now - timedelta(days=7), now=now) == 1
    db_session.commit()
    assert archive_expired(db_session, cutoff=now - timedelta(days=7), now=now) == 0
    assert order.status == "canceled" and order.canceled_at == now
    assert regular.demo_archived_at is None
    assert client.get("/auth/me", headers=headers).status_code == 401
    assert client.post("/auth/refresh").status_code == 401
    assert reconcile_account(db_session, demo) == {"ok": True, "entries": entry_count, "errors": []}
