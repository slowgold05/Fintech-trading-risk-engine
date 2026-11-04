import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
from zipfile import ZipFile

from app.models.aml import AmlCase
from app.models.control_evidence import ControlEvidence
from app.models.sar import SarDraft
from app.models.user import User
from app.scripts.set_user_role import set_role
from app.services.aml_cases import check_case_sla as check_aml_case_sla
from app.services.audit_bundle import build_evidence_zip, check_audit_bundle
from app.services.control_evidence import control_status
from app.services.sar_draft import check_sar_drafts
from app.services.tabletop import run_scenarios


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_tabletop_scenarios_are_caught(client, db_session):
    results = run_scenarios(client, db_session)
    missed = [item["id"] for item in results if not item["caught"]]
    assert missed == [], results


def test_sar_draft_cites_only_the_case_events(client, auth_headers, db_session):
    assert control_status("SM-RP-01", check_sar_drafts(db_session)) == "no_sample"
    auth_headers("sar-subject@example.com", "password123")
    subject = db_session.query(User).filter_by(email="sar-subject@example.com").one()
    case = AmlCase(
        rule_id="SM-AML-01", rule_version=1, subject_user_id=subject.id,
        event_ids=json.dumps(["cash-1", "cash-2"]), summary="Three deposits under the threshold",
        due_at=_now() + timedelta(hours=24), opened_at=_now(),
    )
    db_session.add(case)
    db_session.commit()

    officer = auth_headers("sar-officer@example.com", "password123")
    set_role(db_session, "sar-officer@example.com", "compliance_officer", "test-operator", "SAR test")
    auditor = auth_headers("sar-auditor@example.com", "password123")
    set_role(db_session, "sar-auditor@example.com", "auditor", "test-operator", "SAR test")

    denied = client.post("/compliance/sar-drafts", headers=auditor, json={"case_kind": "aml", "case_id": case.id})
    assert denied.status_code == 403, denied.text
    created = client.post("/compliance/sar-drafts", headers=officer, json={"case_kind": "aml", "case_id": case.id})
    assert created.status_code == 200, created.text
    narrative = created.json()["narrative"]
    assert "cash-1" in narrative and "cash-2" in narrative
    assert "cash-9" not in narrative
    assert "file a sar" not in narrative.casefold()
    assert control_status("SM-RP-01", check_sar_drafts(db_session)) == "pass"

    row = db_session.query(SarDraft).one()
    row.narrative = narrative + "\nAlso cash-9"
    db_session.commit()
    assert control_status("SM-RP-01", check_sar_drafts(db_session)) == "fail"


def test_overdue_aml_case_fails_the_sla_check(auth_headers, db_session):
    auth_headers("aml-sla@example.com", "password123")
    subject = db_session.query(User).filter_by(email="aml-sla@example.com").one()
    assert control_status("SM-AML-03", check_aml_case_sla(db_session)) == "no_sample"
    db_session.add(AmlCase(
        rule_id="SM-AML-01", rule_version=1, subject_user_id=subject.id,
        event_ids=json.dumps(["cash-4"]), summary="Past due",
        due_at=_now() - timedelta(hours=1), opened_at=_now() - timedelta(hours=25),
    ))
    db_session.commit()
    result = check_aml_case_sla(db_session)
    assert result["violation_count"] == 1
    assert control_status("SM-AML-03", result) == "fail"


def test_evidence_bundle_hash_matches_the_payload(db_session):
    assert control_status("SM-AU-01", check_audit_bundle(db_session)) == "no_sample"
    payload = '{"checked": 1}\n'
    digest = sha256(payload.encode()).hexdigest()
    db_session.add(ControlEvidence(
        control_id="SM-PT-06", run_at=_now(), payload=payload, sha256=digest,
    ))
    db_session.commit()
    assert control_status("SM-AU-01", check_audit_bundle(db_session)) == "pass"
    with ZipFile(BytesIO(build_evidence_zip(db_session))) as archive:
        assert archive.read("SM-PT-06.json").decode() == payload
        manifest = json.loads(archive.read("MANIFEST.json"))
    assert manifest["files"] == [{"name": "SM-PT-06.json", "sha256": digest}]

    row = db_session.query(ControlEvidence).one()
    row.sha256 = "0" * 64
    db_session.commit()
    assert control_status("SM-AU-01", check_audit_bundle(db_session)) == "fail"
