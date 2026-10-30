from app.scripts import run_controls


def test_control_runner_marks_empty_market_data_failed_and_writes_both_evidence(monkeypatch):
    written = []
    monkeypatch.setattr(run_controls, "reconcile_ledger", lambda db: {"checked": 1, "failures": []})
    monkeypatch.setattr(run_controls, "check_hot_quote_freshness", lambda db: {"checked": 0, "missing_count": 0, "stale_count": 0})
    monkeypatch.setattr(run_controls, "check_open_order_price_bands", lambda db: {"checked": 2, "violation_count": 1})
    monkeypatch.setattr(run_controls, "check_app_role_grants", lambda db: {"checked": 4, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_role_audit", lambda db: {"checked": 1, "violation_count": 0})
    monkeypatch.setattr(run_controls, "check_idempotency_records", lambda db: {"checked": 0, "unique_constraint": True, "violation_count": 0})
    monkeypatch.setattr(run_controls, "write_evidence", lambda control_id, result: (written.append((control_id, result)) or "evidence.json", "digest"))

    result = run_controls.run(object(), object())

    assert [item["status"] for item in result] == ["pass", "pass", "pass", "fail", "fail", "no_sample"]
    assert [item["control_id"] for item in result] == ["SM-AC-01", "SM-AC-02", "SM-LD-01", "SM-MD-01", "SM-PT-02", "SM-PT-04"]
    assert [control_id for control_id, _ in written] == ["SM-AC-01", "SM-AC-02", "SM-LD-01", "SM-MD-01", "SM-PT-02", "SM-PT-04"]
