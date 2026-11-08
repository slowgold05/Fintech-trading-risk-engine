from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy.exc import DBAPIError

from app.models.asset import Asset
from app.models.control_evidence import ControlEvidence
from app.models.order import Order
from app.models.user import User
from app.routers import compliance
from app.scripts.set_user_role import set_role
from app.services.access_control_check import check_evidence_immutable
from app.services.access_review_check import check_access_reviews
from app.services.buying_power_check import check_buying_power
from app.services.control_evidence import evidence_payload
from app.services import control_evidence
from app.services import scheduled_jobs


def test_database_evidence_overrides_a_file_and_detects_a_bad_hash(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    user = db_session.query(User).one()
    set_role(db_session, user.email, "auditor", "operator", "Read evidence")
    db_session.commit()
    with TemporaryDirectory(dir=Path.cwd()) as folder:
        root = Path(folder)
        definitions = root / "controls"
        definitions.mkdir()
        (definitions / "SM-LD-01.yaml").write_text(
            "id: SM-LD-01\ntitle: Ledger\nowner: Operations\nfrequency: daily\n", encoding="utf-8")
        evidence_dir = root / "evidence" / "SM-LD-01"
        evidence_dir.mkdir(parents=True)
        stale = {"control_id": "SM-LD-01", "run_at": datetime.now(timezone.utc).isoformat(),
                 "result": {"checked": 0, "failures": []}}
        (evidence_dir / "file.json").write_text(json.dumps(stale) + "\n", encoding="utf-8")
        monkeypatch.setattr(compliance, "CONTROL_DIR", definitions)
        monkeypatch.setattr(compliance, "EVIDENCE_DIR", root / "evidence")
        monkeypatch.setattr(control_evidence, "EVIDENCE_DIR", root / "evidence")

        payload = evidence_payload("SM-LD-01", {"checked": 4, "failures": []}, datetime.now(timezone.utc))
        db_session.add(ControlEvidence(control_id="SM-LD-01", run_at=datetime.now(timezone.utc).replace(tzinfo=None),
                                       payload=payload, sha256=sha256(payload.encode()).hexdigest()))
        db_session.commit()
        control = client.get("/compliance/controls", headers=headers).json()["controls"][0]
        assert control["status"] == "pass"
        assert control["checked"] == 4

        db_session.query(ControlEvidence).one().sha256 = "0" * 64
        db_session.commit()
        control = client.get("/compliance/controls", headers=headers).json()["controls"][0]
        assert control["status"] == "evidence_error"


def test_access_review_control_passes_only_after_independent_reviews(client, auth_headers, db_session):
    reviewer_headers = auth_headers("ac-reviewer@example.com")
    auth_headers("ac-subject@example.com")
    admin_headers = auth_headers("ac-admin@example.com")
    set_role(db_session, "ac-reviewer@example.com", "compliance_officer", "bootstrap", "Reviewer")
    set_role(db_session, "ac-admin@example.com", "admin", "bootstrap", "Admin")
    db_session.commit()
    assert check_access_reviews(db_session)["violation_count"] == 3

    users = {user.email: user.id for user in db_session.query(User).all()}
    reviewed = client.post("/compliance/access-review", headers=reviewer_headers, json={
        "user_id": users["ac-subject@example.com"], "decision": "retain", "reason": "Quarterly retain"})
    assert reviewed.status_code == 200, reviewed.text
    assert client.post("/compliance/access-review", headers=reviewer_headers, json={
        "user_id": users["ac-admin@example.com"], "decision": "retain", "reason": "Quarterly retain"}).status_code == 200
    assert check_access_reviews(db_session)["violation_count"] == 1
    assert client.post("/compliance/access-review", headers=admin_headers, json={
        "user_id": users["ac-reviewer@example.com"], "decision": "retain", "reason": "Quarterly retain"}).status_code == 200
    assert check_access_reviews(db_session)["violation_count"] == 0


def test_buying_power_control_flags_reserved_cash_above_balance(client, auth_headers, db_session):
    auth_headers()
    user = db_session.query(User).one()
    assert check_buying_power(db_session)["violation_count"] == 0
    asset = Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True)
    db_session.add(asset)
    db_session.flush()
    db_session.add(Order(user_id=user.id, asset_id=asset.id, side="buy", order_type="limit",
                         quantity=10, remaining_quantity=10, limit_price=20000, status="open"))
    db_session.commit()
    result = check_buying_power(db_session)
    assert result["violations"] == [user.id]
    assert result["violation_count"] == 1


def test_evidence_probe_fails_when_the_database_allows_edits(db_session):
    result = check_evidence_immutable(db_session)
    assert result == {"checked": 2, "violation_count": 2,
                      "violations": ["control_evidence.update", "control_evidence.delete"]}

    class Denied:
        def execute(self, statement):
            raise DBAPIError(str(statement), {}, PermissionError("42501"))

        def rollback(self):
            return None

    denied = check_evidence_immutable(Denied())
    assert denied["violation_count"] == 0
    assert denied["checked"] == 2


def test_scheduled_cycle_refreshes_before_writing_controls(monkeypatch):
    calls = []

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def rollback(self):
            calls.append("rollback")

    monkeypatch.setattr(scheduled_jobs, "SessionLocal", Session)
    monkeypatch.setattr(scheduled_jobs, "acquire_scheduler", lambda db, owner, now, stale_before: True)
    monkeypatch.setattr(scheduled_jobs, "release_scheduler", lambda db, owner: None)
    monkeypatch.setattr(scheduled_jobs, "refresh_market_caches", lambda db: calls.append("refresh") or {})
    monkeypatch.setattr(scheduled_jobs, "run_app_controls", lambda db: calls.append("controls") or [])
    monkeypatch.setattr(scheduled_jobs, "backfill_missing_file_evidence", lambda db: calls.append("backfill") or [])
    monkeypatch.setattr(scheduled_jobs, "run_live_surveillance", lambda db: calls.append("surveillance") or {"opened": 0, "rules": 0})
    monkeypatch.setattr(scheduled_jobs, "run_live_aml", lambda db: calls.append("aml") or {"opened": 0, "rules": 0})
    monkeypatch.setattr(scheduled_jobs, "process_pending_research_jobs", lambda db, limit: calls.append("research") or [])
    monkeypatch.setattr(scheduled_jobs, "build_daily_briefs", lambda db, limit: calls.append("briefs") or [])

    scheduled_jobs.run_scheduled_cycle()

    assert calls == ["refresh", "controls", "backfill", "surveillance", "aml", "research", "briefs"]
