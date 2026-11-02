import json

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.scripts.check_role_audit import check_role_audit
from app.scripts.reconcile_ledger import run as reconcile_ledger
from app.services.control_evidence import control_status, write_evidence
from app.services.market_cache_service import check_hot_quote_freshness
from app.services.pretrade_controls import check_open_order_price_bands, check_trading_halt_audit
from app.services.access_control_check import check_app_role_grants
from app.services.idempotency_check import check_idempotency_records


def run(db, privileged_db) -> list[dict]:
    ledger = reconcile_ledger(db)
    market = check_hot_quote_freshness(db)
    price_bands = check_open_order_price_bands(db)
    trading_halt = check_trading_halt_audit(db)
    access = check_app_role_grants(db)
    role_audit = check_role_audit(privileged_db)
    idempotency = check_idempotency_records(db)
    results = [("SM-AC-01", access), ("SM-AC-02", role_audit),
               ("SM-LD-01", ledger), ("SM-MD-01", market),
               ("SM-PT-01", trading_halt), ("SM-PT-02", price_bands), ("SM-PT-04", idempotency)]
    output = []
    for control_id, result in results:
        path, digest = write_evidence(control_id, result)
        output.append({"control_id": control_id, "status": control_status(control_id, result), "evidence": str(path), "sha256": digest})
    return output


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
