from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from app.core.config import settings
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.mfa import LoginEvent
from app.models.user import User
from app.services.asset_inventory import check_asset_inventory
from app.services.control_evidence import control_status
from app.services.login_risk import assess_login, check_high_risk_logins
from app.services.mfa import check_mfa_enrollment, totp_code


def _clock(monkeypatch):
    state = {"t": 1_700_000_000.0}
    monkeypatch.setattr("app.services.mfa._now_ts", lambda: state["t"])
    return state


def _login(client, email, password="password123", agent="pytest"):
    return client.post("/auth/login", data={"username": email, "password": password}, headers={"User-Agent": agent})


def test_enrolled_login_requires_a_new_code(client, auth_headers, monkeypatch):
    clock = _clock(monkeypatch)
    auth_headers("mfa-user@example.com", "password123")
    secret = client.post("/auth/mfa/enroll", json={"email": "mfa-user@example.com", "password": "password123"}).json()["secret"]
    assert client.post("/auth/mfa/enroll/confirm", json={
        "email": "mfa-user@example.com", "password": "password123", "code": totp_code(secret, clock["t"]),
    }).status_code == 200

    challenged = _login(client, "mfa-user@example.com")
    assert challenged.status_code == 200, challenged.text
    assert challenged.json()["mfa_required"] is True
    assert "access_token" not in challenged.json()
    assert client.post("/auth/login/mfa", json={"challenge_id": challenged.json()["challenge_id"], "code": totp_code(secret, clock["t"])}).status_code == 401
    clock["t"] += 30
    completed = client.post("/auth/login/mfa", json={
        "challenge_id": challenged.json()["challenge_id"], "code": totp_code(secret, clock["t"]),
    })
    assert completed.status_code == 200, completed.text
    assert completed.json()["access_token"]


def test_new_device_without_mfa_does_not_receive_a_session(client, auth_headers):
    auth_headers("device-user@example.com", "password123")
    denied = _login(client, "device-user@example.com", agent="OtherBrowser/1")
    assert denied.status_code == 403
    assert "access_token" not in denied.json()


def test_credential_stuffing_and_impossible_travel_raise_the_score(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "login_geo_prefixes", "10.1.0.0/16=east,10.2.0.0/16=west")
    monkeypatch.setattr(settings, "impossible_travel_minutes", 60)
    headers = auth_headers("travel-user@example.com", "password123")
    user = db_session.query(User).filter_by(email="travel-user@example.com").one()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    success = db_session.query(LoginEvent).filter_by(user_id=user.id, outcome="success").one()
    success.ip = "10.1.0.8"
    success.created_at = now - timedelta(minutes=5)
    for index, email in enumerate(["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"]):
        db_session.add(LoginEvent(
            email=email, ip="testclient", user_agent_hash="abc", outcome="failure", risk_score=0,
            step_up_satisfied=False, reasons="[]", created_at=now - timedelta(minutes=1),
        ))
    db_session.commit()

    class Request:
        headers = {"user-agent": "pytest"}

        class client:
            host = "10.2.0.9"

    travel = assess_login(db_session, user, Request())
    assert "impossible_travel" in travel["reasons"]
    assert travel["step_up"] is True

    stuffed = _login(client, "travel-user@example.com")
    assert stuffed.status_code == 403
    denied = db_session.query(LoginEvent).filter_by(user_id=user.id, outcome="denied").one()
    assert "credential_stuffing" in denied.reasons
    assert client.get("/auth/me", headers=headers).status_code == 200


def test_mfa_and_login_controls_follow_the_population(db_session):
    assert control_status("SM-AC-04", check_mfa_enrollment(db_session)) == "no_sample"
    assert control_status("SM-AC-05", check_high_risk_logins(db_session)) == "no_sample"
    user = User(email="gap@example.com", password_hash="x")
    db_session.add(user)
    db_session.commit()
    assert control_status("SM-AC-04", check_mfa_enrollment(db_session)) == "fail"
    db_session.add(LoginEvent(
        user_id=user.id, email=user.email, ip="127.0.0.1", user_agent_hash="hash", outcome="success",
        risk_score=40, step_up_satisfied=False, reasons='["new_device"]',
        created_at=datetime(2026, 11, 4, 12),
    ))
    db_session.commit()
    assert check_high_risk_logins(db_session)["violation_count"] == 1
    assert control_status("SM-AC-05", check_high_risk_logins(db_session)) == "fail"


def test_large_order_from_an_enrolled_account_needs_a_current_code(client, auth_headers, db_session, monkeypatch):
    clock = _clock(monkeypatch)
    headers = auth_headers("large-order@example.com", "password123")
    secret = client.post("/auth/mfa/setup", headers=headers).json()["secret"]
    assert client.post("/auth/mfa/confirm", headers=headers, json={"code": totp_code(secret, clock["t"])}).status_code == 200
    db_session.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    db_session.flush()
    quoted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
    db_session.add(MarketQuoteCache(symbol="AAPL", price=100, change_amount=0, change_percent=0, volume=0,
                                    source="yahoo", quote_at=quoted_at, fetched_at=quoted_at))
    db_session.commit()
    order = {"symbol": "AAPL", "side": "buy", "quantity": 100, "limit_price": 100}
    blocked = client.post("/orders/", headers={**headers, "Idempotency-Key": str(uuid4())}, json=order)
    assert blocked.status_code == 403, blocked.text
    clock["t"] += 30
    allowed = client.post("/orders/", headers={**headers, "Idempotency-Key": str(uuid4()), "X-Step-Up-Code": totp_code(secret, clock["t"])}, json=order)
    assert allowed.status_code == 200, allowed.text


def test_asset_inventory_requires_the_core_systems():
    result = check_asset_inventory()
    assert result["violation_count"] == 0
    assert result["checked"] >= 4
    assert control_status("SM-AM-01", result) == "pass"
    with TemporaryDirectory() as folder:
        incomplete = Path(folder) / "assets.yaml"
        incomplete.write_text("assets: []\n", encoding="utf-8")
        failed = check_asset_inventory(incomplete)
    assert failed["violation_count"] > 0
    assert control_status("SM-AM-01", failed) == "fail"
