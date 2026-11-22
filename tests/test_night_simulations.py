from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.read_snapshot import SnapshotClockError
from app.core.security import create_access_token
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.routers.night_simulations import router
from app.services import night_simulations


BACKTEST = "/night/simulations/backtest"
RECURRING = "/night/simulations/recurring"
REQUEST = {"symbol": "SIM", "start": "2024-01-02", "end": "2024-01-09", "initial_usd": "25.00"}
FETCHED = datetime(2024, 4, 1, tzinfo=timezone.utc)


@pytest.fixture
def simulation_client(db_session):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db_session
    users = [
        User(email=f"simulation-{role}@example.test", password_hash="unused", role=role)
        for role in ("trader", "auditor")
    ]
    db_session.add_all(users + [MarketSymbol(symbol="SIM", company_name="Fixture", exchange="NYSE")])
    db_session.commit()
    headers = {user.role: {"Authorization": f"Bearer {create_access_token(user.id)}"} for user in users}
    with TestClient(app) as client:
        yield client, headers


def _bar(day, close, *, provider="yahoo", basis="split_adjusted", quality="valid", fetched_at=FETCHED):
    price = Decimal(close)
    return MarketBarDaily(
        symbol="SIM", session_date=date.fromisoformat(day), provider=provider, adjustment_type=basis,
        open=price, high=price, low=price, close=price, volume=100, quality_status=quality, fetched_at=fetched_at,
    )


def test_backtest_uses_fractional_units_and_one_provider_with_gaps(simulation_client, db_session):
    client, headers = simulation_client
    db_session.add_all([
        _bar("2024-01-02", "20", quality="flagged"),
        _bar("2024-01-02", "10", basis="raw"),
        _bar("2024-01-03", "80"),
        _bar("2024-01-04", "100"),
        _bar("2024-01-05", "10", quality="rejected"),
        _bar("2024-01-05", "10", provider="massive"),
        _bar("2024-01-06", "10"),
        _bar("2024-01-08", "96"),
        _bar("2024-01-09", "10", fetched_at=datetime(2035, 1, 1, tzinfo=timezone.utc)),
        _bar("2024-01-10", "200"),
        MarketQuoteCache(symbol="SIM", price=1, source="fixture", quote_at=datetime(2024, 1, 9)),
    ])
    db_session.commit()

    response = client.post(BACKTEST, json=REQUEST | {"symbol": "sim"}, headers=headers["trader"])
    assert response.status_code == 200
    data = response.json()
    assert data["symbol"] == "SIM"
    assert data["mode"] == "backtest"
    assert data["coverage"] == "partial"
    assert data["source"] == {
        "provider": "yahoo", "basis": "split_adjusted", "session_date": "2024-01-08",
        "observed_at": "2024-04-01T00:00:00Z", "coverage": "partial",
    }
    assert (data["start_used"], data["end_used"]) == ("2024-01-03", "2024-01-08")
    assert (data["contributed_usd"], data["end_value_usd"], data["price_return"]) == ("25.00", "30.00", "0.200000")
    assert data["points"] == [
        {"session_date": "2024-01-03", "value_usd": "25.00", "contributed_usd": "25.00"},
        {"session_date": "2024-01-04", "value_usd": "31.25", "contributed_usd": "25.00"},
        {"session_date": "2024-01-08", "value_usd": "30.00", "contributed_usd": "25.00"},
    ]
    assert data["skipped_months"] == []
    assert "Used 3 of 6 expected sessions in the requested window." in data["assumptions"]
    assert client.post(BACKTEST, json=REQUEST, headers=headers["auditor"]).json() == data


def test_backtest_complete_window_and_half_cent_value(simulation_client, db_session):
    client, headers = simulation_client
    # Thu-Fri are the only sessions through the MLK holiday on Monday.
    db_session.add_all([
        _bar("2024-01-11", "3", provider="massive"),
        _bar("2024-01-12", "3.000150", provider="massive"),
        _bar("2024-01-11", "1"),
        _bar("2024-01-12", "2"),
    ])
    db_session.commit()
    response = client.post(
        BACKTEST, json=REQUEST | {"start": "2024-01-11", "end": "2024-01-15", "initial_usd": 100},
        headers=headers["trader"],
    )
    assert response.status_code == 200
    data = response.json()
    assert data["coverage"] == "available"
    assert data["source"]["provider"] == "massive"  # Provider-name tie break.
    assert data["end_value_usd"] == "100.01"
    assert data["price_return"] == "0.000050"


@pytest.mark.parametrize("within_session", [True, False])
def test_backtest_respects_current_session_close(simulation_client, db_session, monkeypatch, within_session):
    client, headers = simulation_client
    fetched_at = datetime(2024, 1, 3, 15, tzinfo=timezone.utc)
    db_session.add_all([_bar("2024-01-02", "20", fetched_at=fetched_at),
                        _bar("2024-01-03", "25", fetched_at=fetched_at)])
    db_session.commit()
    hour = 20 if within_session else 21  # 15:00 or 16:00 in New York.
    monkeypatch.setattr(night_simulations, "snapshot_clock", lambda _db: datetime(2024, 1, 3, hour))
    response = client.post(BACKTEST, json=REQUEST | {"end": "2024-01-03"}, headers=headers["trader"])
    assert response.status_code == 200
    assert response.json()["coverage"] == ("missing" if within_session else "available")


@pytest.mark.parametrize("observations", [0, 1])
def test_backtest_missing_has_no_phantom_trades(simulation_client, db_session, observations):
    client, headers = simulation_client
    db_session.add(_bar("2024-01-02", "42", basis="raw"))
    if observations:
        db_session.add(_bar("2024-01-02", "40"))
    db_session.commit()

    response = client.post(BACKTEST, json=REQUEST, headers=headers["trader"])
    assert response.status_code == 200
    data = response.json()
    assert data["coverage"] == "missing"
    for key in ("source", "start_used", "end_used", "contributed_usd", "end_value_usd", "price_return"):
        assert data[key] is None
    assert data["points"] == data["skipped_months"] == []
    assert f"At least two usable sessions are required. Found {observations}." in data["assumptions"]


@pytest.mark.parametrize(("changes", "field"), [
    ({"start": "2024-02-30"}, "start"),
    ({"start": "1989-12-31"}, "start"),
    ({"end": "2024-01-01"}, "end"),
    ({"end": "2024-01-09T00:00:00Z"}, "end"),
    ({"start": "2020-02-29", "end": "2023-03-01"}, "end"),
    ({"initial_usd": "1000000.01"}, "initial_usd"),
    ({"initial_usd": "0"}, "initial_usd"),
    ({"initial_usd": "0.001"}, "initial_usd"),
    ({"initial_usd": "NaN"}, "initial_usd"),
    ({"symbol": "SIM/XXX"}, "symbol"),
    ({"unsupported": "value"}, "body"),
])
def test_backtest_bad_inputs(simulation_client, changes, field):
    client, headers = simulation_client
    response = client.post(BACKTEST, json=REQUEST | changes, headers=headers["trader"])
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"
    assert field in response.json()["detail"]["fields"]


def test_backtest_accepted_caps_and_future_end(simulation_client):
    client, headers = simulation_client
    response = client.post(BACKTEST, json=REQUEST | {"start": "2020-02-29", "end": "2023-02-28",
                                                     "initial_usd": "1000000.00"}, headers=headers["trader"])
    assert response.status_code == 200
    assert response.json()["coverage"] == "missing"

    today = datetime.now(ZoneInfo("America/New_York")).date()
    response = client.post(BACKTEST, json=REQUEST | {"start": today.isoformat(),
                                                     "end": (today + timedelta(days=1)).isoformat()},
                           headers=headers["trader"])
    assert response.status_code == 422
    assert "end" in response.json()["detail"]["fields"]


def test_backtest_http_errors_and_authentication(simulation_client):
    client, headers = simulation_client
    for credentials in ({}, {"Authorization": "Bearer invalid"}):
        response = client.post(BACKTEST, json=REQUEST, headers=credentials)
        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == "Bearer"
        assert response.json()["detail"]["code"] == "authentication_required"

    response = client.post(BACKTEST, json=REQUEST | {"symbol": "UNKNOWN"}, headers=headers["trader"])
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_symbol"

    response = client.post(BACKTEST, content=b'{"symbol":',
                           headers={**headers["trader"], "Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"


def test_recurring_uses_first_eligible_close_and_lists_gap_months(simulation_client, db_session):
    client, headers = simulation_client
    db_session.add_all([
        _bar("2024-01-02", "15", quality="flagged"),
        _bar("2024-01-03", "80"),
        _bar("2024-01-04", "100"),
        _bar("2024-02-01", "20", quality="flagged"),
        _bar("2024-02-02", "30", basis="raw"),
        _bar("2024-02-02", "30", provider="massive"),
        _bar("2024-03-02", "10"),  # Saturday.
        _bar("2024-03-04", "40"),
        _bar("2024-03-05", "60"),
        _bar("2024-04-01", "100"),
        _bar("2024-04-02", "120"),
        _bar("2024-05-01", "20", fetched_at=datetime(2035, 1, 1, tzinfo=timezone.utc)),
        _bar("2024-06-03", "200"),  # Beyond the requested end.
        MarketQuoteCache(symbol="SIM", price=1, source="fixture", quote_at=datetime(2024, 5, 2)),
    ])
    db_session.commit()

    request = REQUEST | {"start": "2023-12-01", "end": "2024-06-02", "monthly_usd": "50.00"}
    response = client.post(RECURRING, json=request, headers=headers["trader"])
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "recurring"
    assert data["coverage"] == "partial"
    assert data["source"]["provider"] == "yahoo"
    assert (data["start_used"], data["end_used"]) == ("2024-01-03", "2024-04-02")
    assert data["skipped_months"] == ["2024-02", "2024-05"]
    assert (data["contributed_usd"], data["end_value_usd"], data["price_return"]) == ("125.00", "247.50", "0.500000")
    assert data["points"] == [
        {"session_date": "2024-01-03", "value_usd": "25.00", "contributed_usd": "25.00"},
        {"session_date": "2024-01-04", "value_usd": "31.25", "contributed_usd": "25.00"},
        {"session_date": "2024-03-04", "value_usd": "62.50", "contributed_usd": "75.00"},
        {"session_date": "2024-03-05", "value_usd": "93.75", "contributed_usd": "75.00"},
        {"session_date": "2024-04-01", "value_usd": "206.25", "contributed_usd": "125.00"},
        {"session_date": "2024-04-02", "value_usd": "247.50", "contributed_usd": "125.00"},
    ]


def test_recurring_preserves_half_cent_with_repeating_fractional_units(simulation_client, db_session):
    client, headers = simulation_client
    # Exact units are 100/3 in January and 25/3.000150 added on the first day of February.
    db_session.add_all([_bar("2024-01-31", "3"), _bar("2024-02-01", "3.000150")])
    db_session.commit()
    request = REQUEST | {"start": "2024-01-31", "end": "2024-02-01", "initial_usd": 100, "monthly_usd": "25.00"}
    response = client.post(RECURRING, json=request, headers=headers["auditor"])
    assert response.status_code == 200
    data = response.json()
    assert data["coverage"] == "available"
    assert data["skipped_months"] == []
    assert data["contributed_usd"] == "125.00"
    assert data["end_value_usd"] == "125.01"
    assert data["price_return"] == "0.000050"


@pytest.mark.parametrize("monthly", [None, "0", "-1", "100000.01", "0.001", "Infinity", "1e4"])
def test_recurring_rejects_invalid_monthly_amount(simulation_client, monthly):
    client, headers = simulation_client
    request = REQUEST if monthly is None else REQUEST | {"monthly_usd": monthly}
    response = client.post(RECURRING, json=request, headers=headers["trader"])
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"
    assert "monthly_usd" in response.json()["detail"]["fields"]


def test_recurring_accepts_monthly_cap_and_missing_coverage(simulation_client, db_session):
    client, headers = simulation_client
    db_session.add(_bar("2024-01-03", "80"))
    db_session.commit()
    response = client.post(RECURRING, json=REQUEST | {"monthly_usd": "100000.00"}, headers=headers["trader"])
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "recurring"
    assert data["coverage"] == "missing"
    assert data["contributed_usd"] is None
    assert data["points"] == data["skipped_months"] == []


@pytest.mark.parametrize("endpoint", [BACKTEST, RECURRING])
def test_simulation_unavailable_storage_is_structured(simulation_client, monkeypatch, endpoint):
    def unavailable(_db):
        raise SnapshotClockError("internal failure")

    client, headers = simulation_client
    monkeypatch.setattr(night_simulations, "snapshot_clock", unavailable)
    request = REQUEST | {"monthly_usd": "50.00"} if endpoint == RECURRING else REQUEST
    response = client.post(endpoint, json=request, headers=headers["trader"])
    assert response.status_code == 503
    assert response.json() == {"detail": {"code": "storage_unavailable", "message": "Simulation data is temporarily unavailable."}}
