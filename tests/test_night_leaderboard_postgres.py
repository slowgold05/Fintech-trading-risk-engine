from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import delete

from app.models.asset import Asset
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.models.night_leaderboard import NightLeaderboardEntry
from app.routers.night_leaderboard import router
from app.services import ledger_service, night_leaderboard
from app.services.cash_movements import post_movement
from app.services.exchange_calendar import expected_session_dates
from app.services.ledger_service import ensure_opening
from app.services.trade_execution import execute_fill
from tests.night_notebook_support import bearer, fixture_user, notebook_sessions, trial_client


PATH = "/night/leaderboard"
ME = f"{PATH}/me"
CLOCK = datetime(2026, 11, 18, 12)


def _demo(db, opening, *, fills=None, **attributes):
    seed = {"mode": "historical" if fills else "cash_only", "display_name": "Private demo name",
            "opening_date": opening.isoformat(), "fills": fills or []}
    user = fixture_user(db, demo_seed=seed, **attributes)
    ensure_opening(db, user, effective_on=opening)
    return user


def _book(db, start, end, *, missing_end=False):
    price = Decimal(100)
    symbol = f"N{uuid4().hex[:9].upper()}"
    asset = Asset(symbol=symbol, asset_type="stock", name="Synthetic ranking asset")
    db.add_all([asset, MarketSymbol(symbol=symbol, company_name="Synthetic ranking asset", exchange="NASDAQ")])
    db.flush()
    days = expected_session_dates(start, end)
    for day in days[:-1] if missing_end else days:
        mark = price if day < end else Decimal(110)
        db.add(MarketBarDaily(symbol=symbol, session_date=day, provider="fixture", adjustment_type="raw",
                              open=mark, high=mark, low=mark, close=mark, volume=1,
                              fetched_at=CLOCK.replace(tzinfo=timezone.utc), quality_status="valid"))
    fill = {"symbol": symbol, "date": start.isoformat(), "side": "buy", "quantity": 10,
            "price": str(price), "provider": "fixture", "adjustment": "raw"}
    user = _demo(db, start, fills=[fill])
    execute_fill(db, user, asset, "buy", Decimal(10), price,
                 executed_at=datetime.combine(start, time.min), demo_seed=True)
    return user


@pytest.fixture
def ranking_fixture(notebook_sessions, monkeypatch):
    monkeypatch.setattr(night_leaderboard, "snapshot_clock", lambda db: CLOCK)
    start, end = night_leaderboard._window(CLOCK)
    with notebook_sessions.begin() as db:
        funded = _demo(db, start)
        cash = _demo(db, start - timedelta(days=3))
        sparse = _book(db, start, end, missing_end=True)
        winner = _book(db, start, end)
        fresh = _demo(db, end)
        archived = _demo(db, start, demo_archived_at=CLOCK)
        trader = fixture_user(db)
        auditor = fixture_user(db, role="auditor")

        deposit_date = expected_session_dates(start, end)[10]

        class DepositTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls.combine(deposit_date, time(hour=12), tzinfo=tz)

        with monkeypatch.context() as patch:
            patch.setattr(ledger_service, "datetime", DepositTime)
            post_movement(db, funded, "deposit", Decimal(10000), screening_id=None)

    users = funded, cash, sparse, winner, fresh, archived, trader, auditor
    try:
        yield start, end, users
    finally:
        with notebook_sessions.begin() as db:
            db.execute(delete(NightLeaderboardEntry).where(NightLeaderboardEntry.user_id.in_([u.id for u in users])))


def _opt_in(client, headers, alias):
    response = client.put(ME, headers=headers, json={"enabled": True, "alias": alias})
    assert response.status_code == 200
    return response.json()


def test_ranks_a_shared_cash_flow_adjusted_window_and_excludes_sparse_endpoints(notebook_sessions, ranking_fixture):
    start, end, users = ranking_fixture
    funded, cash, sparse, winner, fresh, archived, trader, auditor = users
    with notebook_sessions.begin() as db:
        db.add_all([NightLeaderboardEntry(user_id=archived.id, alias="Hidden archived"),
                    NightLeaderboardEntry(user_id=trader.id, alias="Hidden regular")])

    with trial_client(router, notebook_sessions) as client:
        headers = bearer(funded.id)
        before = client.get(PATH, headers=headers).json()
        assert before == {"start": str(start), "end": str(end), "coverage": "missing", "excluded_count": 0,
                          "items": [], "my_entry": {"enabled": False, "alias": None}}
        assert _opt_in(client, headers, "  alpha   paper ") == {"enabled": True, "alias": "alpha paper"}
        assert client.get(PATH, headers=headers).json()["items"] == []
        assert client.get(PATH, headers=bearer(archived.id)).status_code == 401
        for intruder in (trader, auditor):
            assert client.get(PATH, headers=bearer(intruder.id)).status_code == 403
            assert client.put(ME, headers=bearer(intruder.id), json={"enabled": False}).status_code == 403

        _opt_in(client, bearer(cash.id), "Zulu paper")
        _opt_in(client, bearer(sparse.id), "Sparse endpoint")
        _opt_in(client, bearer(fresh.id), "Fresh account")
        _opt_in(client, bearer(winner.id), "Gain paper")
        expected = {
            "start": str(start), "end": str(end), "coverage": "partial", "excluded_count": 2,
            "items": [
                {"rank": 1, "alias": "Gain paper", "return_ratio": "0.001000"},
                {"rank": 2, "alias": "alpha paper", "return_ratio": "0.000000"},
                {"rank": 3, "alias": "Zulu paper", "return_ratio": "0.000000"},
            ],
            "my_entry": {"enabled": True, "alias": "alpha paper"},
        }
        assert client.get(PATH, headers=headers).json() == expected
        assert client.get(PATH, headers=headers).json() == expected
        for departed in (cash, winner):
            other = bearer(departed.id)
            for _ in range(2):
                response = client.put(ME, headers=other, json={"enabled": False})
                assert response.status_code == 200 and response.json() == {"enabled": False, "alias": None}
        after = client.get(PATH, headers=headers).json()
        assert after["items"] == [] and after["coverage"] == "missing" and after["excluded_count"] == 2


def test_rank_alias_validation_conflict_and_atomic_reuse(notebook_sessions, ranking_fixture):
    _, _, (first, second, *_) = ranking_fixture
    with trial_client(router, notebook_sessions) as client, ThreadPoolExecutor(max_workers=2) as executor:
        assert client.get(PATH).status_code == 401
        headers, other = bearer(first.id), bearer(second.id)
        for invalid in ({"enabled": True}, {"enabled": True, "alias": "a@b.invalid"},
                        {"enabled": True, "alias": "ab"}, {"enabled": "true", "alias": "valid"}):
            response = client.put(ME, headers=headers, json=invalid)
            assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_request"
        attempts = [executor.submit(client.put, ME, headers=who, json={"enabled": True, "alias": alias})
                    for who, alias in ((headers, " Paper   Ace "), (other, "paper ace"))]
        responses = [attempt.result() for attempt in attempts]
        assert sorted(response.status_code for response in responses) == [200, 409]
        winner, loser = (headers, other) if responses[0].status_code == 200 else (other, headers)
        assert next(response for response in responses if response.status_code == 409).json() == {
            "detail": {"code": "alias_in_use", "message": "This alias is already in use."},
        }
        winning_alias = client.get(PATH, headers=winner).json()["my_entry"]["alias"]
        assert _opt_in(client, winner, winning_alias)["alias"] == winning_alias
        assert _opt_in(client, loser, "Other alias")["alias"] == "Other alias"
        assert client.put(ME, headers=loser, json={"enabled": True, "alias": winning_alias}).status_code == 409
        assert client.get(PATH, headers=loser).json()["my_entry"]["alias"] == "Other alias"
        assert client.put(ME, headers=winner, json={"enabled": False}).status_code == 200
        assert _opt_in(client, loser, winning_alias)["alias"] == winning_alias
