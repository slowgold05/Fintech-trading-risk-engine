from datetime import datetime, timedelta
from decimal import Decimal

from app.models.asset import Asset
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.surveillance import SurveillanceActivation, SurveillanceCase
from app.models.trade import Trade
from app.models.user import User
from app.scripts.set_user_role import set_role
from app.services.control_evidence import control_status
from app.services.order_book import cancel_order
from app.services.surveillance_backtest import score_all
from app.services.surveillance_cases import check_case_sla, run_live_surveillance


def test_labeled_scores_compute_precision_and_recall():
    scores = score_all()
    assert set(scores) == {"SM-SV-01", "SM-SV-02", "SM-SV-03", "SM-SV-04"}
    for score in scores.values():
        alerts = score["true_positive"] + score["false_positive"]
        labeled = score["true_positive"] + score["false_negative"]
        assert score["scenarios"] == 4
        assert score["misses"] == []
        assert score["true_positive"] == 2
        assert score["false_positive"] == 0
        assert score["true_negative"] == 2
        assert score["false_negative"] == 0
        assert score["precision"] == score["true_positive"] / alerts
        assert score["recall"] == score["true_positive"] / labeled


def test_backtest_does_not_open_cases(db_session):
    score_all()
    assert db_session.query(SurveillanceCase).count() == 0


def test_case_sla_status_follows_due_time(db_session):
    assert control_status("SM-SV-05", check_case_sla(db_session)) == "no_sample"
    user = User(email="subject-sla@example.com", password_hash="x")
    db_session.add(user)
    db_session.flush()
    case = SurveillanceCase(
        rule_id="SM-SV-01", rule_version=1, subject_user_id=user.id, symbol="NVDA",
        event_ids="[]", summary="Late case", opened_at=datetime(2026, 10, 31, 12),
        due_at=datetime(2026, 11, 1, 12),
    )
    db_session.add(case)
    db_session.commit()
    assert check_case_sla(db_session, datetime(2026, 11, 3, 12))["violation_count"] == 1
    assert control_status("SM-SV-05", check_case_sla(db_session, datetime(2026, 11, 3, 12))) == "fail"
    case.status = "closed"
    case.closed_at = datetime(2026, 11, 2, 12)
    case.closed_by_user_id = None
    db_session.commit()
    assert check_case_sla(db_session, datetime(2026, 11, 3, 12))["violation_count"] == 1
    case.closed_at = datetime(2026, 11, 1, 11)
    db_session.commit()
    assert check_case_sla(db_session, datetime(2026, 11, 3, 12))["violation_count"] == 0
    assert control_status("SM-SV-05", check_case_sla(db_session, datetime(2026, 11, 3, 12))) == "pass"


def test_cancel_records_a_timestamp(db_session):
    user = User(email="cancel-sv@example.com", password_hash="x")
    asset = Asset(symbol="NVDA", asset_type="stock", name="NVIDIA", is_active=True)
    db_session.add_all([user, asset, MarketSymbol(symbol="NVDA", company_name="NVIDIA", exchange="NASDAQ")])
    db_session.flush()
    order = Order(
        user_id=user.id, asset_id=asset.id, side="buy", order_type="limit", quantity=Decimal("1"),
        remaining_quantity=Decimal("1"), limit_price=Decimal("10"), status="open",
        created_at=datetime(2026, 11, 3, 15),
    )
    db_session.add(order)
    db_session.commit()
    canceled = cancel_order(db_session, user.id, order.id)
    assert canceled.status == "canceled"
    assert canceled.canceled_at is not None


def test_activation_needs_a_different_reviewer(client, auth_headers, db_session):
    admin_headers = auth_headers("admin-sv@example.com", "password123")
    set_role(db_session, "admin-sv@example.com", "admin", "test-operator", "Surveillance test")
    officer_headers = auth_headers("officer-sv@example.com", "password123")
    set_role(db_session, "officer-sv@example.com", "compliance_officer", "test-operator", "Surveillance test")
    trader_headers = auth_headers("trader-sv@example.com", "password123")
    db_session.commit()

    assert client.get("/compliance/surveillance/rules", headers=trader_headers).status_code == 403
    assert client.post("/compliance/surveillance/rules/SM-SV-01/request", headers=trader_headers,
                       json={"reason": "Trader cannot request"}).status_code == 403
    assert client.post("/compliance/surveillance/rules/SM-SV-99/request", headers=admin_headers,
                       json={"reason": "Missing rule"}).status_code == 404

    created = client.post("/compliance/surveillance/rules/SM-SV-01/request", headers=admin_headers,
                          json={"reason": "Labeled backtest passed"})
    assert created.status_code == 200, created.text
    request_id = created.json()["id"]
    assert client.post("/compliance/surveillance/rules/SM-SV-01/request", headers=officer_headers,
                       json={"reason": "Duplicate pending"}).status_code == 409
    assert client.post(f"/compliance/surveillance/activations/{request_id}/approve",
                       headers=admin_headers).status_code == 403

    row = db_session.get(SurveillanceActivation, request_id)
    row.version = 99
    db_session.commit()
    mismatch = client.post(f"/compliance/surveillance/activations/{request_id}/approve", headers=officer_headers)
    assert mismatch.status_code == 409
    row.version = 1
    db_session.commit()
    approved = client.post(f"/compliance/surveillance/activations/{request_id}/approve", headers=officer_headers)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "active"
    states = {item["id"]: item for item in client.get("/compliance/surveillance/rules", headers=officer_headers).json()["rules"]}
    assert states["SM-SV-01"]["activation_status"] == "active"

    replacement = client.post("/compliance/surveillance/rules/SM-SV-01/request", headers=officer_headers,
                              json={"reason": "Replace the active version"})
    assert replacement.status_code == 200, replacement.text
    replaced = client.post(f"/compliance/surveillance/activations/{replacement.json()['id']}/approve", headers=admin_headers)
    assert replaced.status_code == 200, replaced.text
    statuses = [item.status for item in db_session.query(SurveillanceActivation).filter_by(rule_id="SM-SV-01").all()]
    assert statuses.count("active") == 1
    assert "retired" in statuses


def test_subject_cannot_close_their_own_case(client, auth_headers, db_session):
    admin_headers = auth_headers("admin-close@example.com", "password123")
    set_role(db_session, "admin-close@example.com", "admin", "test-operator", "Close test")
    officer_headers = auth_headers("officer-close@example.com", "password123")
    set_role(db_session, "officer-close@example.com", "compliance_officer", "test-operator", "Close test")
    officer = db_session.query(User).filter_by(email="officer-close@example.com").one()
    case = SurveillanceCase(
        rule_id="SM-SV-01", rule_version=1, subject_user_id=officer.id, symbol="NVDA",
        event_ids="[]", summary="Officer traded", due_at=datetime(2026, 11, 4, 15),
        opened_at=datetime(2026, 11, 3, 15),
    )
    db_session.add(case)
    db_session.commit()
    body = {"disposition": "false_positive", "reason": "The reviewer placed the fill"}
    assert client.post(f"/compliance/surveillance/cases/{case.id}/close", headers=officer_headers, json=body).status_code == 403
    closed = client.post(f"/compliance/surveillance/cases/{case.id}/close", headers=admin_headers, json=body)
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"
    assert client.post(f"/compliance/surveillance/cases/{case.id}/close", headers=admin_headers, json=body).status_code == 409


def test_live_scan_opens_one_wash_case_for_an_active_rule(db_session):
    subject = User(email="wash-subject@example.com", password_hash="x")
    requester = User(email="wash-requester@example.com", password_hash="x")
    approver = User(email="wash-approver@example.com", password_hash="x")
    asset = Asset(symbol="NVDA", asset_type="stock", name="NVIDIA", is_active=True)
    db_session.add_all([subject, requester, approver, asset])
    db_session.flush()
    start = datetime(2026, 11, 3, 15, 0)
    db_session.add_all([
        Trade(user_id=subject.id, asset_id=asset.id, side="buy", quantity=Decimal("100"),
              price_at_execution=Decimal("10"), executed_at=start),
        Trade(user_id=subject.id, asset_id=asset.id, side="sell", quantity=Decimal("100"),
              price_at_execution=Decimal("10.02"), executed_at=start + timedelta(minutes=5)),
    ])
    db_session.commit()
    quiet = run_live_surveillance(db_session, start + timedelta(minutes=10))
    assert quiet == {"opened": 0, "rules": 0}
    db_session.add(SurveillanceActivation(
        rule_id="SM-SV-01", version=1, reason="Active for the scan test",
        requested_by_user_id=requester.id, approved_by_user_id=approver.id, status="active",
        approved_at=start,
    ))
    db_session.commit()
    first = run_live_surveillance(db_session, start + timedelta(minutes=10))
    second = run_live_surveillance(db_session, start + timedelta(minutes=11))
    assert first == {"opened": 1, "rules": 1}
    assert second == {"opened": 0, "rules": 1}
    case = db_session.query(SurveillanceCase).one()
    assert case.rule_id == "SM-SV-01"
    assert case.subject_user_id == subject.id
    assert case.symbol == "NVDA"
    assert case.status == "open"
    assert case.due_at == start + timedelta(minutes=10, hours=24)
