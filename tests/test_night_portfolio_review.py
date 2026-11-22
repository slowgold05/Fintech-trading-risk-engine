"""Owner-scoped, dated review tests with independent ledger and risk arithmetic."""

from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.database import get_db
from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.market_bar_daily import MarketBarDaily
from app.models.user import User
from app.routers.night_portfolio_review import review_router
from app.routers.portfolio import router as portfolio_router
from app.services.cash_movements import post_movement
from app.services.exchange_calendar import expected_session_dates
from app.services.ledger_service import ensure_opening, reconcile_account
from app.services.trade_execution import execute_fill
from tests.test_portfolio_performance import _add_quote, _add_symbol, _bar

CLOCK = datetime(2026, 3, 16, 2)
END = date(2026, 3, 13)
REVIEW = "/night/portfolio/review"


def mount_night_api(db, *routers):
    app = FastAPI()
    for router in routers:
        app.include_router(router)
    app.include_router(portfolio_router, prefix="/portfolio")

    def get_test_db():
        yield db

    app.dependency_overrides[get_db] = get_test_db
    return TestClient(app)


@pytest.fixture
def review_client(db_session, monkeypatch):
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: CLOCK)
    return mount_night_api(db_session, review_router)


def _new_book(db, opening: date, cash: str, email="review-fixture@example.com"):
    user = User(email=email, password_hash="unused-in-token-fixture", cash_balance=Decimal(cash))
    db.add(user)
    db.flush()
    ensure_opening(db, user, effective_on=opening)
    db.commit()
    return user


def _headers(user):
    return {"Authorization": "Bearer " + create_access_token(user_id=user.id)}


def _post_on(monkeypatch, day, post, *args):
    class LedgerClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.combine(day, time(16), tzinfo=tz)

    with monkeypatch.context() as dated:
        dated.setattr("app.services.ledger_service.datetime", LedgerClock)
        post(*args)


def _close(db, symbol, day, value, **source):
    _bar(db, symbol, day, fetched_at=datetime(2026, 3, 14, tzinfo=timezone.utc),
         close_price=Decimal(value), **source)


def _stock(db, symbol):
    _add_symbol(db, symbol)
    asset = Asset(symbol=symbol, asset_type="stock", name=symbol)
    db.add(asset)
    db.flush()
    return asset


def _flow_book(db, monkeypatch):
    opening, buy, gap_1, gap_2, sell = expected_session_dates(date(2026, 3, 9), END)
    owner = _new_book(db, opening, "1000.00")
    sold = _stock(db, "SOLD")
    _add_symbol(db, "SPY")
    _post_on(monkeypatch, buy, execute_fill, db, owner, sold, "buy", Decimal(10), Decimal(50))
    _post_on(monkeypatch, gap_1, post_movement, db, owner, "deposit", Decimal(100), None)
    _post_on(monkeypatch, sell, execute_fill, db, owner, sold, "sell", Decimal(10), Decimal(55))
    _close(db, "SOLD", buy, "60.00")
    for day, amount in zip((opening, buy, gap_1, gap_2, sell), (100, 105, 107, 108, 110), strict=True):
        _close(db, "SPY", day, amount)
    db.commit()
    assert reconcile_account(db, owner)["ok"]
    return owner, (opening, buy, gap_1, gap_2, sell)


def test_named_calendar_windows_and_night_errors(review_client, db_session, monkeypatch):
    owner = _new_book(db_session, date(2025, 12, 1), "1000")
    headers = _headers(owner)
    assert review_client.get(REVIEW).status_code == 401
    assert review_client.get(REVIEW, headers=headers).json()["window"] == "1m"
    starts = {"1m": "2026-02-13", "3m": "2025-12-13", "ytd": "2025-12-31", "1y": "2025-03-13"}
    for window, start in starts.items():
        response = review_client.get(REVIEW, params={"window": window}, headers=headers)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["window"] == window
        assert result["read_at"] == "2026-03-16T02:00:00Z"
        assert result["requested_start"] == start
        assert result["requested_end"] == END.isoformat()
        dates = [day.isoformat() for day in expected_session_dates(date.fromisoformat(start), END)]
        assert result["expected_sessions"] == len(dates)
        assert [point["session_date"] for point in result["points"]] == dates

    bad = review_client.get(REVIEW, params={"window": "2y"}, headers=headers)
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "invalid_request"
    assert list(bad.json()["detail"]["fields"]) == ["window"]

    def fail_storage():
        raise OperationalError("private SQL", {}, RuntimeError("private connection information"))

    review_client.app.dependency_overrides[get_db] = fail_storage
    unavailable = review_client.get(REVIEW, headers=headers)
    assert unavailable.status_code == 503
    assert unavailable.json() == {
        "detail": {"code": "storage_unavailable", "message": "Portfolio data is temporarily unavailable."},
    }

    # Jan 2 at 01:00 UTC is still Jan 1 in New York, so YTD has no current-year close.
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: datetime(2026, 1, 2, 1))
    result = mount_night_api(db_session, review_router).get(
        REVIEW, params={"window": "ytd"}, headers=headers,
    ).json()
    assert result["requested_start"] == result["requested_end"] == "2025-12-31"
    assert result["metrics"]["return_ratio"] is None
    assert result["coverage"] == "missing"


def test_flow_across_gap_and_fully_sold_contribution(review_client, db_session, monkeypatch):
    owner, days = _flow_book(db_session, monkeypatch)
    opening, buy, gap_1, gap_2, sell = [day.isoformat() for day in days]
    response = review_client.get(REVIEW, headers=_headers(owner))
    assert response.status_code == 200, response.text
    review = response.json()
    assert (review["start_used"], review["end_used"]) == (opening, sell)
    assert review["valued_sessions"] == 3
    assert review["coverage"] == "partial"
    assert {gap_1, gap_2} <= set(review["missing_sessions"])
    points = {point["session_date"]: point for point in review["points"]}
    for day in (gap_1, gap_2):
        assert list(points[day].values()) == [day, None, None, None]
    assert points[buy]["portfolio_return_ratio"] == "0.10000000"
    assert review["metrics"] == {
        "return_ratio": "0.05000000",
        "spy_return_ratio": "0.10000000",
        "excess_return_ratio": "-0.05000000",
        "max_drawdown_ratio": "-0.04545455",
        "annualized_volatility_ratio": None,
        "beta_to_spy": None,
        "correlation_to_spy": None,
        "daily_sample_count": 1,
        "paired_sample_count": 1,
    }
    assert review["observations"] == [
        {"symbol": "SPY", "provider": "fixture", "basis": "raw", "from_date": opening, "to_date": sell},
        {"symbol": "SOLD", "provider": "fixture", "basis": "raw", "from_date": buy, "to_date": buy},
    ]
    assert review["contribution"] == {
        "coverage": "available", "scope": "period", "items": [{"symbol": "SOLD", "pnl_usd": "50.00"}],
        "residual_usd": "0.00", "reason": None,
    }
    assert review["exposure"] == {
        "coverage": "available", "as_of": "2026-03-16T02:00:00Z", "cash_weight_ratio": "1.00000000",
        "sectors": [], "unpriced_symbols": [],
    }


def test_risk_sample_variance_exact_pairs_and_constant_spy(review_client, db_session, monkeypatch):
    days = expected_session_dates(date(2026, 2, 2), END)[-21:]
    owner = _new_book(db_session, days[0], "100")
    asset = _stock(db_session, "RISK")
    _add_symbol(db_session, "SPY")
    _post_on(monkeypatch, days[0], execute_fill, db_session, owner, asset, "buy", Decimal(1), Decimal(100))
    for i, day in enumerate(days):
        close = 125 if i % 2 else 100
        _close(db_session, "RISK", day, close)
        _close(db_session, "SPY", day, close)
    db_session.commit()
    headers = _headers(owner)

    def metrics():
        response = review_client.get(REVIEW, params={"window": "3m"}, headers=headers)
        assert response.status_code == 200, response.text
        return response.json()["metrics"]

    matched = metrics()
    # 10 daily returns of +0.25, 10 of -0.20. Mean 0.025 and deviations ±0.225.
    vol = (Decimal("0.225") ** 2 * 20 / 19 * 252).sqrt().quantize(Decimal("0.00000001"))
    assert matched == {
        "return_ratio": "0.00000000", "spy_return_ratio": "0.00000000", "excess_return_ratio": "0.00000000",
        "max_drawdown_ratio": "-0.20000000", "annualized_volatility_ratio": str(vol),
        "daily_sample_count": 20, "paired_sample_count": 20, "beta_to_spy": "1.00000000",
        "correlation_to_spy": "1.00000000",
    }

    for bar in db_session.scalars(select(MarketBarDaily).where(MarketBarDaily.symbol == "SPY")):
        bar.open = bar.high = bar.low = bar.close = Decimal(100)
    db_session.commit()
    constant = metrics()
    assert constant["beta_to_spy"] is constant["correlation_to_spy"] is None
    assert constant["paired_sample_count"] == 20
    assert constant["annualized_volatility_ratio"] == str(vol)

    middle = db_session.get(MarketBarDaily, ("SPY", days[10], "fixture", "raw"))
    db_session.delete(middle)
    db_session.commit()
    gapped = metrics()
    assert gapped["paired_sample_count"] == 18
    assert gapped["daily_sample_count"] == 20


def test_split_and_unverified_adjusted_basis_suppress_period_dollars(review_client, db_session, monkeypatch):
    first, last = date(2026, 3, 12), END
    owner = _new_book(db_session, first, "200")
    asset = _stock(db_session, "SPLT")
    _post_on(monkeypatch, first, execute_fill, db_session, owner, asset, "buy", Decimal(1), Decimal(100))
    _close(db_session, "SPLT", first, 100)
    _close(db_session, "SPLT", last, 70)
    _close(db_session, "SPLT", first, 66, adjustment="split_adjusted")
    _close(db_session, "SPLT", last, 70, adjustment="split_adjusted")
    db_session.commit()

    def result():
        response = review_client.get(REVIEW, headers=_headers(owner))
        assert response.status_code == 200, response.text
        return response.json()

    raw = result()
    assert raw["metrics"]["return_ratio"] == "-0.15000000"
    assert raw["contribution"]["coverage"] == "missing"
    assert "split" in raw["contribution"]["reason"]
    assert raw["contribution"]["residual_usd"] is None
    assert raw["contribution"]["items"] == []

    for day in (first, last):
        db_session.delete(db_session.get(MarketBarDaily, ("SPLT", day, "fixture", "raw")))
    db_session.commit()
    adjusted = result()
    assert adjusted["metrics"]["return_ratio"] is not None
    assert adjusted["contribution"]["coverage"] == "missing"
    assert adjusted["contribution"]["reason"].startswith("Split-adjusted marks")


def test_owner_isolation_no_marks_and_reset(review_client, db_session, monkeypatch):
    owner, _ = _flow_book(db_session, monkeypatch)
    other = _new_book(db_session, date(2026, 3, 9), "200", email="second-fixture@example.com")
    other_headers = _headers(other)
    hidden = _stock(db_session, "HIDE")
    _post_on(monkeypatch, date(2026, 3, 9), execute_fill, db_session, other, hidden, "buy", Decimal(1), Decimal(100))
    db_session.commit()

    empty = review_client.get(REVIEW, headers=other_headers).json()
    assert empty["coverage"] == "missing"
    assert empty["start_used"] is empty["end_used"] is None
    assert empty["valued_sessions"] == 0
    assert empty["contribution"]["reason"]
    assert empty["exposure"]["unpriced_symbols"] == ["HIDE"]
    assert empty["exposure"]["cash_weight_ratio"] is None
    assert "SOLD" not in str(empty)

    owner_headers = _headers(owner)
    assert "HIDE" not in str(review_client.get(REVIEW, headers=owner_headers).json())
    with monkeypatch.context() as dated:
        class ResetClock(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 3, 16, 16, tzinfo=tz)

        dated.setattr("app.services.ledger_service.datetime", ResetClock)
        assert review_client.post("/portfolio/reset", headers=owner_headers).status_code == 200
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: datetime(2026, 3, 18, 13))
    reset = review_client.get(REVIEW, headers=owner_headers).json()
    assert reset["start_used"] == "2026-03-16"
    assert reset["end_used"] == "2026-03-17"
    assert reset["metrics"]["return_ratio"] == "0.00000000"
    assert reset["contribution"]["items"] == []
    assert reconcile_account(db_session, owner)["ok"]
    assert reconcile_account(db_session, other)["ok"]


def test_ambiguous_and_future_marks_are_not_spliced(review_client, db_session, monkeypatch):
    first, last = date(2026, 3, 12), END
    owner = _new_book(db_session, first, "1000")
    asset = _stock(db_session, "HELD")
    _add_symbol(db_session, "SPY")
    _post_on(monkeypatch, first, execute_fill, db_session, owner, asset, "buy", Decimal(3), Decimal(100))
    _close(db_session, "HELD", first, 100)
    _close(db_session, "HELD", last, 100)
    _add_quote(db_session, "HELD", Decimal(100), quote_at=datetime(2026, 3, 13, 21))
    _close(db_session, "SPY", first, 100, provider="fixture-a")
    _close(db_session, "SPY", last, 112, provider="fixture-b")
    _bar(db_session, "SPY", last, provider="fixture-a", fetched_at=datetime(2026, 3, 17, tzinfo=timezone.utc),
         close_price=Decimal(110))
    db_session.commit()

    review = review_client.get(REVIEW, headers=_headers(owner)).json()
    assert review["metrics"]["return_ratio"] == "0.00000000"
    assert review["metrics"]["spy_return_ratio"] is None
    assert review["metrics"]["excess_return_ratio"] is None
    assert review["metrics"]["paired_sample_count"] == 0
    assert review["exposure"]["cash_weight_ratio"] == "0.70000000"
    assert review["exposure"]["sectors"] == [{"sector": "Other", "value_usd": "300.00", "weight_ratio": "0.30000000"}]
