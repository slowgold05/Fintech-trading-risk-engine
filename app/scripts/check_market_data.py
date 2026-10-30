import json

from app.core.database import SessionLocal
from app.services.control_evidence import write_evidence
from app.services.market_cache_service import check_hot_quote_freshness


def main() -> None:
    with SessionLocal() as db:
        result = check_hot_quote_freshness(db)
    path, digest = write_evidence("SM-MD-01", result)
    print(json.dumps({"result": result, "evidence": str(path), "sha256": digest}, sort_keys=True))
    if result["checked"] == 0 or result["missing_count"] or result["stale_count"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
