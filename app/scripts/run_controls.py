import json

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.scripts.check_role_audit import check_role_audit
from app.scripts.reconcile_ledger import run as reconcile_ledger
from app.services.access_control_check import check_app_role_grants, check_evidence_immutable
from app.services.access_review_check import check_access_reviews
from app.services.buying_power_check import check_buying_power
from app.services.control_evidence import control_status, write_evidence
from app.services.idempotency_check import check_idempotency_records
from app.services.market_cache_service import check_hot_quote_freshness
from app.services.aml_cases import check_case_sla as check_aml_case_sla
from app.services.asset_inventory import check_asset_inventory
from app.services.audit_bundle import check_audit_bundle
from app.services.incidents import check_incident_notices
from app.services.sanctions import check_sanctions_screening
from app.services.findings import check_open_findings
from app.services.risk_brief import check_briefs
from app.services.sar_draft import check_sar_drafts
from app.services.trade_intents import check_intent_approvals, check_signal_gate
from app.services.login_risk import check_high_risk_logins
from app.services.mfa import check_mfa_enrollment
from app.services.pretrade_controls import check_open_order_price_bands, check_trading_halt_audit
from app.services.surveillance_cases import check_case_sla


def app_control_results(db) -> list[tuple[str, dict]]:
    return [
        ("SM-AC-01", check_app_role_grants(db)),
        ("SM-AC-03", check_access_reviews(db)),
        ("SM-AC-04", check_mfa_enrollment(db)),
        ("SM-AC-05", check_high_risk_logins(db)),
        ("SM-EV-01", check_evidence_immutable(db)),
        ("SM-LD-01", reconcile_ledger(db)),
        ("SM-MD-01", check_hot_quote_freshness(db)),
        ("SM-PT-01", check_trading_halt_audit(db)),
        ("SM-PT-02", check_open_order_price_bands(db)),
        ("SM-PT-04", check_idempotency_records(db)),
        ("SM-PT-06", check_buying_power(db)),
        ("SM-SV-05", check_case_sla(db)),
        ("SM-AM-01", check_asset_inventory()),
        ("SM-AML-03", check_aml_case_sla(db)),
        ("SM-SN-01", check_sanctions_screening(db)),
        ("SM-IR-01", check_incident_notices(db)),
        ("SM-RP-01", check_sar_drafts(db)),
        ("SM-AU-01", check_audit_bundle(db)),
        ("SM-DQ-01", check_open_findings(db, "SM-DQ-01")),
        ("SM-FC-01", check_open_findings(db, "SM-FC-01")),
        ("SM-AI-01", check_intent_approvals(db)),
        ("SM-SG-01", check_signal_gate(db)),
        ("SM-BR-01", check_briefs(db)),
    ]


def persist_results(db, results: list[tuple[str, dict]]) -> list[dict]:
    output = []
    for control_id, result in results:
        path, digest = write_evidence(control_id, result, db)
        output.append({"control_id": control_id, "status": control_status(control_id, result),
                       "evidence": str(path), "sha256": digest})
    return output


def run(db, privileged_db) -> list[dict]:
    results = app_control_results(db)
    results.insert(1, ("SM-AC-02", check_role_audit(privileged_db)))
    return persist_results(db, results)


def main() -> None:
    if not settings.migration_database_url:
        raise SystemExit("MIGRATION_DATABASE_URL is required for the role audit control")
    engine = create_engine(settings.migration_database_url)
    try:
        with SessionLocal() as db, Session(engine) as privileged_db:
            results = run(db, privileged_db)
    finally:
        engine.dispose()
    print(json.dumps({"controls": results}, sort_keys=True))
    if any(item["status"] == "fail" for item in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
