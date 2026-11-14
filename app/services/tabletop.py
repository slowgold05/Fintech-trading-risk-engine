from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.mfa import LoginEvent
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.aml_backtest import parse_event
from app.services.aml_rules import load_rules as load_aml_rules
from app.services.login_risk import assess_login
from app.services.order_book import place_order
from app.services.surveillance_backtest import load_scenarios
from app.services.surveillance_detect import detect
from app.services.surveillance_rules import load_rules


def _result(scenario_id: str, title: str, mitre: str, caught: bool, note: str) -> dict:
    return {"id": scenario_id, "title": title, "mitre": mitre, "caught": caught, "note": note}


def run_scenarios(client, db) -> list[dict]:
    # Stuffing inserts failures for this client address. Later logins from the same
    # address would be denied, so the sign-in scenarios run before that insert.
    return [
        _refresh_replay(client),
        _other_account_cash(client),
        _credential_stuffing(client, db),
        _double_sell(db),
        _detector("SM-SV-01", "Wash-trading pattern", "No ATT&CK technique. Financial-abuse check against SM-SV-01."),
        _detector("SM-SV-02", "Spoofing pattern", "No ATT&CK technique. Financial-abuse check against SM-SV-02."),
        _aml_detector(),
    ]


def _credential_stuffing(client, db) -> dict:
    email = "tabletop-stuff@example.com"
    assert client.post("/auth/register", json={"email": email, "password": "password123"}).status_code == 200
    user = db.query(User).filter_by(email=email).one()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for index in range(5):
        db.add(LoginEvent(
            email=f"other{index % 3}@example.com", ip="testclient", user_agent_hash="abc", outcome="failure",
            risk_score=0, step_up_satisfied=False, reasons="[]", created_at=now,
        ))
    db.commit()

    class Request:
        headers = {"user-agent": "pytest"}

        class client:
            host = "testclient"

    assessment = assess_login(db, user, Request())
    denied = client.post("/auth/login", data={"username": email, "password": "password123"}, headers={"User-Agent": "pytest"})
    caught = assessment["step_up"] and denied.status_code == 403 and "access_token" not in denied.json()
    return _result("credential-stuffing", "Credential stuffing", "T1110.004", caught,
                   "Five failures across three emails from one address raise the score and the login is denied.")


def _refresh_replay(client) -> dict:
    email = "tabletop-refresh@example.com"
    assert client.post("/auth/register", json={"email": email, "password": "password123"}).status_code == 200
    assert client.post("/auth/login", data={"username": email, "password": "password123"}).status_code == 200
    first = client.cookies.get("refresh_token")
    assert client.post("/auth/refresh").status_code == 200
    client.cookies.set("refresh_token", first)
    replay = client.post("/auth/refresh")
    return _result("refresh-replay", "Reused refresh token", "T1550.004", replay.status_code == 401,
                   "A refresh token is revoked when it is rotated. The old cookie is rejected.")


def _other_account_cash(client) -> dict:
    first = {"Authorization": "Bearer " + client.post("/auth/login", data={"username": "tabletop-refresh@example.com", "password": "password123"}).json()["access_token"]}
    posted = client.post("/cash/movements", headers={**first, "Idempotency-Key": "tabletopcash1"}, json={"kind": "deposit", "amount": "10.00"})
    assert posted.status_code == 200, posted.text
    email = "tabletop-other@example.com"
    assert client.post("/auth/register", json={"email": email, "password": "password123"}).status_code == 200
    second_token = client.post("/auth/login", data={"username": email, "password": "password123"}).json()["access_token"]
    seen = client.get("/cash/movements", headers={"Authorization": f"Bearer {second_token}"}).json()["movements"]
    return _result("other-account-cash", "Another account's cash movements", "T1078",
                   all(item["id"] != posted.json()["id"] for item in seen),
                   "ATT&CK has no IDOR technique. This check uses an authenticated account and confirms it cannot list another account's cash movements.")


def _double_sell(db) -> dict:
    quoted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
    db.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    db.flush()
    db.add(MarketQuoteCache(symbol="AAPL", price=100, change_amount=0, change_percent=0, volume=0,
                            source="yahoo", quote_at=quoted_at, fetched_at=quoted_at))
    db.commit()
    user = db.query(User).filter_by(email="tabletop-stuff@example.com").one()
    try:
        place_order(db, user.id, OrderCreate(symbol="AAPL", side="sell", quantity=1, limit_price=100))
        caught = False
        note = "The sell was accepted."
    except HTTPException as exc:
        caught = exc.status_code == 400 and exc.detail == "Not enough holdings to sell"
        note = str(exc.detail)
        db.rollback()
    return _result("double-sell", "Sell without holdings", "No ATT&CK technique. Business-abuse check.", caught, note)


def _detector(rule_id: str, title: str, mitre: str) -> dict:
    rule = load_rules()[rule_id]
    from app.services.surveillance_backtest import parse_event
    positive = next(item for item in load_scenarios(rule_id) if item["label"])
    fired = bool(detect(rule, [parse_event(item) for item in positive["events"]]))
    return _result(rule_id, title, mitre, fired, f"Labeled scenario {positive['id']} was scored by the detector. No order was sent.")


def _aml_detector() -> dict:
    from app.services.aml_backtest import load_scenarios as load_aml_scenarios
    from app.services.aml_detect import detect as detect_aml
    rule = load_aml_rules()["SM-AML-01"]
    positive = next(item for item in load_aml_scenarios("SM-AML-01") if item["label"])
    fired = bool(detect_aml(rule, [parse_event(item) for item in positive["events"]]))
    return _result("SM-AML-01", "Structuring pattern", "No ATT&CK technique. Financial-abuse check against SM-AML-01.",
                   fired, f"Labeled scenario {positive['id']} was scored by the detector. No payment was sent.")
