from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import datetime, timedelta, timezone
import json

import pytest
from sqlalchemy.exc import DBAPIError

from app.models.user import User
from app.models.role_change import RoleChange
from app.models.role_change_request import RoleChangeRequest
from app.models.access_review import AccessReview
from app.routers import compliance
from app.scripts.set_user_role import apply_request, set_role
from app.scripts.check_role_audit import check_role_audit
from app.services.access_control_check import check_app_role_grants
from app.services import control_evidence


def test_compliance_controls_require_role_and_show_no_sample(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    assert client.get("/auth/me", headers=headers).json()["role"] == "trader"
    assert client.get("/compliance/controls", headers=headers).status_code == 403
    assert client.get("/compliance/role-changes", headers=headers).status_code == 403
    assert client.get("/compliance/risks", headers=headers).status_code == 403

    with TemporaryDirectory(dir=Path.cwd()) as folder:
        root = Path(folder)
        control_dir = root / "controls"
        control_dir.mkdir()
        (control_dir / "SM-LD-01.yaml").write_text("id: SM-LD-01\ntitle: Ledger\nowner: Operations\nfrequency: daily\n", encoding="utf-8")
        (control_dir / "SM-PT-02.yaml").write_text("id: SM-PT-02\ntitle: Price band\nowner: Operations\nfrequency: daily\n", encoding="utf-8")
        monkeypatch.setattr(compliance, "CONTROL_DIR", control_dir)
        monkeypatch.setattr(compliance, "EVIDENCE_DIR", root / "evidence")
        monkeypatch.setattr(control_evidence, "EVIDENCE_DIR", root / "evidence")
        control_evidence.write_evidence("SM-PT-02", {"checked": 0, "violation_count": 0})

        user = db_session.query(User).one()
        change = set_role(db_session, user.email, "auditor", "test-operator", "Read-only review")
        db_session.commit()
        assert change.old_role == "trader"
        assert db_session.query(RoleChange).one().reason == "Read-only review"
        assert client.get("/auth/me", headers=headers).json()["role"] == "auditor"
        response = client.get("/compliance/controls", headers=headers)
        assert response.status_code == 200, response.text
        controls = {item["id"]: item for item in response.json()["controls"]}
        assert controls["SM-LD-01"]["status"] == "not_run"
        control = controls["SM-PT-02"]
        assert control["id"] == "SM-PT-02"
        assert control["status"] == "no_sample"
        assert control["checked"] == 0
        assert len(control["sha256"]) == 64
        ledger_evidence = root / "evidence" / "SM-LD-01"
        ledger_evidence.mkdir()
        (ledger_evidence / "corrupt.json").write_text("{", encoding="utf-8")
        controls = {item["id"]: item for item in client.get("/compliance/controls", headers=headers).json()["controls"]}
        assert controls["SM-LD-01"]["status"] == "evidence_error"
        changes = client.get("/compliance/role-changes", headers=headers).json()["changes"]
        assert len(changes) == 1
        assert changes[0]["new_role"] == "auditor"
        assert changes[0]["actor"] == "test-operator"

        assert client.post("/orders/", headers=headers, json={"symbol": "AAPL", "side": "buy", "quantity": 1, "limit_price": 100}).status_code == 403
        assert client.post("/trades/", headers=headers, json={"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}).status_code == 403
        assert client.post("/portfolio/reset", headers=headers).status_code == 403


def test_role_change_requires_reason_and_refuses_noop(client, auth_headers, db_session):
    auth_headers()
    user = db_session.query(User).one()
    with pytest.raises(ValueError, match="reason"):
        set_role(db_session, user.email, "auditor", "operator", " ")
    with pytest.raises(ValueError, match="already"):
        set_role(db_session, user.email, "trader", "operator", "No change")
    assert db_session.query(RoleChange).count() == 0


def test_risk_register_uses_recent_pass_and_conservatively_handles_missing_evidence(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    user = db_session.query(User).one()
    set_role(db_session, user.email, "auditor", "operator", "Risk review")
    db_session.commit()
    with TemporaryDirectory(dir=Path.cwd()) as folder:
        root = Path(folder)
        definitions = root / "controls"
        definitions.mkdir()
        (definitions / "SM-LD-01.yaml").write_text("id: SM-LD-01\ntitle: Ledger\nowner: Operations\nfrequency: daily\n", encoding="utf-8")
        (definitions / "SM-PT-02.yaml").write_text("id: SM-PT-02\ntitle: Band\nowner: Operations\nfrequency: daily\n", encoding="utf-8")
        register = root / "risks.yaml"
        register.write_text("method: test\nrisks:\n  - id: R-01\n    title: Ledger\n    owner: Operations\n    inherent_rating: high\n    controls: [SM-LD-01]\n  - id: R-02\n    title: Order\n    owner: Operations\n    inherent_rating: moderate\n    controls: [SM-PT-02]\n", encoding="utf-8")
        monkeypatch.setattr(compliance, "CONTROL_DIR", definitions)
        monkeypatch.setattr(compliance, "RISK_REGISTER", register)
        monkeypatch.setattr(compliance, "EVIDENCE_DIR", root / "evidence")
        monkeypatch.setattr(control_evidence, "EVIDENCE_DIR", root / "evidence")
        path, _ = control_evidence.write_evidence("SM-LD-01", {"checked": 1, "failures": []})
        control_evidence.write_evidence("SM-PT-02", {"checked": 0, "violation_count": 0})

        risks = {risk["id"]: risk for risk in client.get("/compliance/risks", headers=headers).json()["risks"]}
        assert risks["R-01"]["residual_rating"] == "moderate"
        assert risks["R-01"]["control_health"] == "effective"
        assert risks["R-02"]["residual_rating"] == "moderate"
        assert risks["R-02"]["control_health"] == "unverified"

        stale = json.loads(path.read_text(encoding="utf-8"))
        stale["run_at"] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        path.write_text(json.dumps(stale), encoding="utf-8")
        risks = {risk["id"]: risk for risk in client.get("/compliance/risks", headers=headers).json()["risks"]}
        assert risks["R-01"]["residual_rating"] == "high"
        assert risks["R-01"]["control_health"] == "unverified"

        stale["run_at"] = datetime.now(timezone.utc).isoformat()
        stale["result"] = {"checked": 1, "failures": ["ledger mismatch"]}
        path.write_text(json.dumps(stale), encoding="utf-8")
        risks = {risk["id"]: risk for risk in client.get("/compliance/risks", headers=headers).json()["risks"]}
        assert risks["R-01"]["control_health"] == "failed"


def test_access_control_probe_requires_both_database_denials(db_session):
    assert check_app_role_grants(db_session)["violations"] == ["users.role", "role_changes.reason", "role_change_requests.target_user_id", "access_reviews.reason"]

    class DeniedDb:
        rollbacks = 0

        def execute(self, statement):
            raise DBAPIError(str(statement), {}, PermissionError(1143))

        def rollback(self):
            self.rollbacks += 1

    denied = DeniedDb()
    assert check_app_role_grants(denied) == {"checked": 4, "violation_count": 0, "violations": []}
    assert denied.rollbacks == 4

    class MySqlError(Exception):
        sqlstate = "42000"

    class MySqlDenied(DeniedDb):
        def execute(self, statement):
            raise DBAPIError(str(statement), {}, MySqlError(1143))

    assert check_app_role_grants(MySqlDenied())["violation_count"] == 0


def test_role_request_needs_distinct_admin_and_compliance_approval(client, auth_headers, db_session):
    admin_headers = auth_headers("role-admin@example.com")
    approver_headers = auth_headers("role-approver@example.com")
    target_headers = auth_headers("role-target@example.com")
    set_role(db_session, "role-admin@example.com", "admin", "bootstrap", "First admin")
    set_role(db_session, "role-approver@example.com", "compliance_officer", "bootstrap", "First approver")
    db_session.commit()
    payload = {"email": "role-target@example.com", "role": "analyst", "reason": "Assigned to analysis"}

    assert client.post("/compliance/role-requests", headers=approver_headers, json=payload).status_code == 403
    assert client.post("/compliance/role-requests", headers=target_headers, json=payload).status_code == 403
    created = client.post("/compliance/role-requests", headers=admin_headers, json=payload)
    assert created.status_code == 200, created.text
    request_id = created.json()["id"]
    with pytest.raises(ValueError, match="Approved"):
        apply_request(db_session, request_id, "operator")
    assert client.post(f"/compliance/role-requests/{request_id}/approve", headers=admin_headers).status_code == 403
    approved = client.post(f"/compliance/role-requests/{request_id}/approve", headers=approver_headers)
    assert approved.status_code == 200, approved.text
    assert client.post(f"/compliance/role-requests/{request_id}/approve", headers=approver_headers).status_code == 409
    change = apply_request(db_session, request_id, "migration-operator")
    db_session.commit()
    assert change.request_id == request_id
    assert db_session.get(RoleChangeRequest, request_id).status == "applied"
    assert client.get("/auth/me", headers=target_headers).json()["role"] == "analyst"
    with pytest.raises(ValueError, match="Approved"):
        apply_request(db_session, request_id, "migration-operator")
    stale_request = client.post("/compliance/role-requests", headers=admin_headers,
                                json={**payload, "role": "trader"}).json()["id"]
    set_role(db_session, "role-target@example.com", "trader", "operator", "Temporary return")
    set_role(db_session, "role-target@example.com", "analyst", "operator", "Returned to analysis")
    db_session.commit()
    assert client.post(f"/compliance/role-requests/{stale_request}/approve", headers=approver_headers).status_code == 409


def test_quarterly_access_review_is_independent_and_append_only(client, auth_headers, db_session):
    reviewer_headers = auth_headers("reviewer@example.com")
    target_headers = auth_headers("reviewed@example.com")
    auditor_headers = auth_headers("read-only-auditor@example.com")
    set_role(db_session, "reviewer@example.com", "compliance_officer", "bootstrap", "Reviewer")
    set_role(db_session, "read-only-auditor@example.com", "auditor", "bootstrap", "Audit")
    db_session.commit()
    reviewer = db_session.query(User).filter_by(email="reviewer@example.com").one()
    target = db_session.query(User).filter_by(email="reviewed@example.com").one()
    assert client.get("/compliance/access-review", headers=target_headers).status_code == 403
    assert client.get("/compliance/access-review", headers=auditor_headers).status_code == 200
    assert client.post("/compliance/access-review", headers=auditor_headers,
                       json={"user_id": target.id, "decision": "retain", "reason": "Role needed"}).status_code == 403
    assert client.post("/compliance/access-review", headers=reviewer_headers,
                       json={"user_id": reviewer.id, "decision": "retain", "reason": "Self review"}).status_code == 403
    reviewed = client.post("/compliance/access-review", headers=reviewer_headers,
                           json={"user_id": target.id, "decision": "retain", "reason": "Role needed"})
    assert reviewed.status_code == 200, reviewed.text
    assert client.post("/compliance/access-review", headers=reviewer_headers,
                       json={"user_id": target.id, "decision": "remove", "reason": "Changed mind"}).status_code == 409
    accounts = client.get("/compliance/access-review", headers=auditor_headers).json()["accounts"]
    assert next(item for item in accounts if item["user_id"] == target.id)["status"] == "retain"
    assert next(item for item in accounts if item["user_id"] == reviewer.id)["status"] == "unreviewed"
    assert db_session.query(AccessReview).count() == 1

    set_role(db_session, target.email, "analyst", "operator", "Moved to analysis")
    set_role(db_session, target.email, "trader", "operator", "Returned to desk")
    db_session.commit()
    accounts = client.get("/compliance/access-review", headers=auditor_headers).json()["accounts"]
    assert next(item for item in accounts if item["user_id"] == target.id)["status"] == "unreviewed"
    assert client.post("/compliance/access-review", headers=reviewer_headers,
                       json={"user_id": target.id, "decision": "remove", "reason": "Role no longer needed"}).status_code == 200
    assert db_session.query(AccessReview).count() == 2


def test_role_audit_control_reports_missing_trigger_and_rolls_back(auth_headers, db_session):
    auth_headers()
    result = check_role_audit(db_session)
    assert result == {"checked": 1, "violation_count": 1,
                      "violations": ["Direct role update lacked an audit row"]}
    assert db_session.query(User).one().role == "trader"
    assert db_session.query(RoleChange).count() == 0
