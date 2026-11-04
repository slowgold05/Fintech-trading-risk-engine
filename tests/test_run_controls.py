from app.scripts import run_controls


def test_control_runner_marks_empty_market_data_failed_and_writes_both_evidence(monkeypatch):
    written = []
    monkeypatch.setattr(run_controls, "reconcile_ledger", lambda db: {"checked": 1, "failures": []})
    monkeypatch.setattr(run_controls, "check_hot_quote_freshness", lambda db: {"checked": 0, "missing_count": 0, "stale_count": 0})
    monkeypatch.setattr(run_controls, "check_open_order_price_bands", lambda db: {"checked": 2, "violation_count": 1})
    monkeypatch.setattr(run_controls, "check_trading_halt_audit", lambda db: {"checked": 0, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_app_role_grants", lambda db: {"checked": 5, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_role_audit", lambda db: {"checked": 1, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_access_reviews", lambda db: {"checked": 2, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_evidence_immutable", lambda db: {"checked": 2, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_buying_power", lambda db: {"checked": 2, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_idempotency_records", lambda db: {"checked": 0, "unique_constraint": True, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_case_sla", lambda db: {"checked": 1, "violation_count": 0, "breached_case_ids": []})
    monkeypatch.setattr(run_controls, "check_mfa_enrollment", lambda db: {"checked": 1, "violation_count": 0, "missing_user_ids": []})
    monkeypatch.setattr(run_controls, "check_high_risk_logins", lambda db: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "check_asset_inventory", lambda: {"checked": 1, "violation_count": 0, "violations": []})
    monkeypatch.setattr(run_controls, "check_aml_case_sla", lambda db: {"checked": 1, "violation_count": 0, "breached_case_ids": []})
    monkeypatch.setattr(run_controls, "check_sanctions_screening", lambda db: {"checked": 1, "violation_count": 0, "violations": []})
    monkeypatch.setattr(run_controls, "check_incident_notices", lambda db: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "check_sar_drafts", lambda db: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "check_audit_bundle", lambda db: {"checked": 1, "violation_count": 0, "violations": []})
    monkeypatch.setattr(run_controls, "check_open_findings", lambda db, control_id: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "check_intent_approvals", lambda db: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "check_signal_gate", lambda db: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "check_briefs", lambda db: {"checked": 1, "violation_count": 0, "violation_ids": []})
    monkeypatch.setattr(run_controls, "write_evidence", lambda control_id, result, db=None: (written.append((control_id, result)) or "evidence.json", "digest"))

    result = run_controls.run(object(), object())

    assert [item["status"] for item in result] == ["pass", "pass", "pass", "pass", "pass", "pass", "pass", "fail", "no_sample", "fail", "no_sample", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass"]
    assert [item["control_id"] for item in result] == ["SM-AC-01", "SM-AC-02", "SM-AC-03", "SM-AC-04", "SM-AC-05", "SM-EV-01", "SM-LD-01", "SM-MD-01", "SM-PT-01", "SM-PT-02", "SM-PT-04", "SM-PT-06", "SM-SV-05", "SM-AM-01", "SM-AML-03", "SM-SN-01", "SM-IR-01", "SM-RP-01", "SM-AU-01", "SM-DQ-01", "SM-FC-01", "SM-AI-01", "SM-SG-01", "SM-BR-01"]
    assert [control_id for control_id, _ in written] == ["SM-AC-01", "SM-AC-02", "SM-AC-03", "SM-AC-04", "SM-AC-05", "SM-EV-01", "SM-LD-01", "SM-MD-01", "SM-PT-01", "SM-PT-02", "SM-PT-04", "SM-PT-06", "SM-SV-05", "SM-AM-01", "SM-AML-03", "SM-SN-01", "SM-IR-01", "SM-RP-01", "SM-AU-01", "SM-DQ-01", "SM-FC-01", "SM-AI-01", "SM-SG-01", "SM-BR-01"]
