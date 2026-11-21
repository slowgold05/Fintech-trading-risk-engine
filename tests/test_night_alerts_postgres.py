from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.models.night_alerts import NightAlert
from app.routers.night_alerts import router
from app.services.night_alerts import MARKET_TIME
from tests.night_notebook_support import bearer, fixture_user, notebook_sessions, trial_client


PATH = "/night/alerts"


def _symbol(db):
    symbol = f"N{uuid4().hex[:10].upper()}"
    db.add(MarketSymbol(symbol=symbol, company_name="Notebook fixture", exchange="NASDAQ"))
    return symbol


def _bar(db, symbol, day, price, *, provider="fixture", adjustment="raw", quality="valid", fetched_at):
    db.add(MarketBarDaily(
        symbol=symbol, session_date=day, provider=provider, adjustment_type=adjustment,
        quality_status=quality, open=price, high=price, low=price, close=price,
        volume=1, fetched_at=fetched_at,
    ))


def test_raw_close_rule_checks_each_session_once_and_keeps_its_trigger(notebook_sessions):
    now = datetime.now(timezone.utc)
    newest = now.astimezone(MARKET_TIME).date() - timedelta(days=1)
    prior = newest - timedelta(days=1)
    with notebook_sessions.begin() as db:
        owner = fixture_user(db)
        stranger = fixture_user(db)
        symbol, missing = _symbol(db), _symbol(db)
        db.flush()
        _bar(db, symbol, prior, 99, fetched_at=now)
        _bar(db, symbol, newest, 150, provider="rejected", quality="rejected", fetched_at=now)
        _bar(db, symbol, newest, 150, adjustment="split_adjusted", fetched_at=now)
        _bar(db, symbol, newest, 150, provider="future", fetched_at=now + timedelta(days=1))
        _bar(db, missing, newest, 150, adjustment="split_adjusted", fetched_at=now)

    with trial_client(router, notebook_sessions) as client:
        headers, other = bearer(owner.id), bearer(stranger.id)
        payload = {"symbol": f" {symbol.lower()} ", "direction": "at_or_above", "target": "100"}
        created = client.post(PATH, json=payload, headers=headers)
        assert created.status_code == 201
        alert_id = created.json()["id"]
        duplicate = client.post(PATH, json={**payload, "target": "100.000000"}, headers=headers)
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"]["code"] == "duplicate_alert"
        assert client.get(PATH, headers=other).json() == {"items": []}
        assert client.delete(f"{PATH}/{alert_id}", headers=other).status_code == 404
        assert client.post(PATH, json={**payload, "symbol": missing}, headers=headers).status_code == 201

        first = client.post(f"{PATH}/evaluate", headers=headers)
        assert first.status_code == 200
        last, no_data = first.json()["items"]
        assert last["status"] == "armed"
        assert last["last_close"] == "99.000000"
        assert last["source"] == {
            "provider": "fixture", "basis": "raw", "session_date": str(prior),
            "observed_at": now.isoformat().replace("+00:00", "Z"), "coverage": "available",
        }
        assert no_data["status"] == "armed"
        assert no_data["source"] is no_data["last_date"] is no_data["last_close"] is None

        with notebook_sessions.begin() as db:
            bar = db.get(MarketBarDaily, (symbol, prior, "fixture", "raw"))
            bar.open = bar.high = bar.low = bar.close = Decimal("120")
        assert client.post(f"{PATH}/evaluate", headers=headers).json() == first.json()

        with notebook_sessions.begin() as db:
            _bar(db, symbol, newest, 100, provider="massive", fetched_at=now)
            _bar(db, symbol, newest, 50, fetched_at=now)
        fired = client.post(f"{PATH}/evaluate", json={}, headers=headers).json()
        fired_alert = fired["items"][0]
        assert fired_alert["status"] == "triggered" and fired_alert["triggered_at"]
        assert fired_alert["last_date"] == str(newest)
        assert fired_alert["last_close"] == "100.000000"
        assert fired_alert["source"]["provider"] == "massive"
        assert client.post(f"{PATH}/evaluate", headers=headers).json() == fired
        assert client.get(PATH, headers=headers).json() == fired
        assert client.post(PATH, json=payload, headers=headers).status_code == 201
        assert client.delete(f"{PATH}/{alert_id}", headers=headers).status_code == 204
        assert client.delete(f"{PATH}/{alert_id}", headers=headers).status_code == 404


def test_alert_cap_and_input_checks_under_concurrent_creates(notebook_sessions):
    with notebook_sessions.begin() as db:
        owner = fixture_user(db)
        nontrader = fixture_user(db, role="auditor")
        symbol = _symbol(db)
        db.flush()
        db.add_all(NightAlert(user_id=owner.id, symbol=symbol, direction="at_or_below", target=target)
                   for target in range(1, 25))
    payload = {"symbol": symbol, "direction": "at_or_below", "target": "25"}
    with trial_client(router, notebook_sessions) as client, ThreadPoolExecutor(max_workers=2) as executor:
        headers = bearer(owner.id)
        unauth = client.get(PATH)
        assert unauth.status_code == 401 and unauth.headers["WWW-Authenticate"] == "Bearer"
        assert client.get(PATH, headers=bearer(nontrader.id)).status_code == 403
        assert client.post(PATH, json={**payload, "symbol": "UNKNOWNSTOCK"}, headers=headers).status_code == 404
        for value in ["NaN", "-1", "0.0000001", "1000000000000"]:
            invalid = client.post(PATH, json={**payload, "target": value}, headers=headers)
            assert invalid.status_code == 422
            assert "target" in invalid.json()["detail"]["fields"]
        assert client.delete(f"{PATH}/2147483648", headers=headers).status_code == 422
        first = executor.submit(client.post, PATH, json=payload, headers=headers)
        second = executor.submit(client.post, PATH, json={**payload, "target": "26"}, headers=headers)
        assert sorted([first.result().status_code, second.result().status_code]) == [201, 409]
        assert len(client.get(PATH, headers=headers).json()["items"]) == 25
