from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.models.aml import AmlCase, Incident
from app.models.user import User
from app.scripts.set_user_role import set_role
from app.services.aml_backtest import score_all
from app.services.control_evidence import control_status
from app.services.incidents import check_incident_notices
from app.services.sanctions import check_sanctions_screening


def _move(client, headers, kind, amount):
    return client.post("/cash/movements", headers={**headers, "Idempotency-Key": uuid4().hex},
                       json={"kind": kind, "amount": amount})


def test_labeled_aml_scenarios_have_precision_and_recall():
    scores = score_all()
    assert set(scores) == {"SM-AML-01", "SM-AML-02"}
    for score in scores.values():
        assert score["misses"] == []
        assert score["precision"] == 1
        assert score["recall"] == 1


def test_a_sanctioned_name_cannot_register_or_withdraw(client, auth_headers, db_session):
    blocked = client.post("/auth/register", json={
        "email": "blocked-name@example.com", "password": "password123", "full_name": "Test Sanctioned Person",
    })
    assert blocked.status_code == 403, blocked.text
    assert db_session.query(User).filter_by(email="blocked-name@example.com").one_or_none() is None

    headers = auth_headers("cash-user@example.com", "password123")
    unnamed = _move(client, headers, "withdrawal", "25.00")
    assert unnamed.status_code == 403, unnamed.text

    renamed = client.put("/auth/name", headers=headers, json={"full_name": "Test Sanctioned Person"})
    assert renamed.status_code == 403, renamed.text
    user = db_session.query(User).filter_by(email="cash-user@example.com").one()
    assert user.full_name is None

    saved = client.put("/auth/name", headers=headers, json={"full_name": "Ada Trader"})
    assert saved.status_code == 200, saved.text
    paid = _move(client, headers, "withdrawal", "25.00")
    assert paid.status_code == 200, paid.text
    assert control_status("SM-SN-01", check_sanctions_screening(db_session)) == "pass"


def test_structuring_opens_a_case_only_after_activation(client, auth_headers, db_session):
    headers = auth_headers("struct-user@example.com", "password123")
    for _ in range(3):
        posted = _move(client, headers, "deposit", "4000.00")
        assert posted.status_code == 200, posted.text
    assert db_session.query(AmlCase).count() == 0

    admin = auth_headers("aml-admin@example.com", "password123")
    set_role(db_session, "aml-admin@example.com", "admin", "test-operator", "AML test")
    officer = auth_headers("aml-officer@example.com", "password123")
    set_role(db_session, "aml-officer@example.com", "compliance_officer", "test-operator", "AML test")
    db_session.commit()
    created = client.post("/compliance/aml/rules/SM-AML-01/request", headers=admin, json={"reason": "Labeled backtest passed"})
    assert created.status_code == 200, created.text
    assert client.post(f"/compliance/aml/activations/{created.json()['id']}/approve", headers=admin).status_code == 403
    approved = client.post(f"/compliance/aml/activations/{created.json()['id']}/approve", headers=officer)
    assert approved.status_code == 200, approved.text
    scanned = client.post("/compliance/aml/run", headers=officer)
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["opened"] == 1
    case = db_session.query(AmlCase).one()
    subject = db_session.query(User).filter_by(email="struct-user@example.com").one()
    assert case.subject_user_id == subject.id
    assert case.rule_id == "SM-AML-01"


def test_incident_notice_uses_a_30_day_clock_and_a_second_person(client, auth_headers, db_session):
    assert control_status("SM-IR-01", check_incident_notices(db_session)) == "no_sample"
    admin = auth_headers("ir-admin@example.com", "password123")
    set_role(db_session, "ir-admin@example.com", "admin", "test-operator", "Incident test")
    officer = auth_headers("ir-officer@example.com", "password123")
    set_role(db_session, "ir-officer@example.com", "compliance_officer", "test-operator", "Incident test")
    db_session.commit()
    opened = client.post("/compliance/incidents", headers=admin, json={
        "title": "Paper notice drill", "severity": "moderate", "summary": "Design test only",
    })
    assert opened.status_code == 200, opened.text
    incident_id = opened.json()["id"]
    assert client.post(f"/compliance/incidents/{incident_id}/notify", headers=admin).status_code == 403
    assert client.post(f"/compliance/incidents/{incident_id}/close", headers=officer).status_code == 409
    assert client.post(f"/compliance/incidents/{incident_id}/notify", headers=officer).status_code == 200
    closed = client.post(f"/compliance/incidents/{incident_id}/close", headers=officer)
    assert closed.status_code == 200, closed.text

    stale = Incident(
        title="Late notice", severity="high", summary="Past the customer clock",
        discovered_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=31),
        customer_notice_due_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1),
        opened_by_user_id=db_session.query(User).filter_by(email="ir-admin@example.com").one().id,
    )
    db_session.add(stale)
    db_session.commit()
    assert check_incident_notices(db_session)["violation_count"] == 1
    assert control_status("SM-IR-01", check_incident_notices(db_session)) == "fail"
