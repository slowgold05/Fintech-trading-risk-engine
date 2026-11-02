import argparse
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.ledger_entry import LedgerEntry
from app.models.user import User
from app.services.control_evidence import write_evidence
from app.services.ledger_service import ensure_opening, reconcile_account


def run(db: Session, initialize: bool = False) -> dict:
    user_ids = db.execute(select(User.id)).scalars().all()
    failures = []
    initialized = 0
    for user_id in user_ids:
        if initialize:
            user = db.execute(
                select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
            ).scalar_one()
            had_entries = db.execute(
                select(LedgerEntry.id).where(LedgerEntry.user_id == user_id).limit(1)
            ).first() is not None
            ensure_opening(db, user)
            db.commit()
            initialized += not had_entries
        else:
            user = db.get(User, user_id)

        result = reconcile_account(db, user)
        if not result["ok"]:
            failures.append({"user_id": user_id, "errors": result["errors"]})

    return {"checked": len(user_ids), "initialized": initialized, "failures": failures}


def main() -> None:
    parser = argparse.ArgumentParser(description="Check ledger hashes, balanced postings, cash, and positions.")
    parser.add_argument("--initialize", action="store_true", help="Snapshot existing accounts once after migrating.")
    args = parser.parse_args()
    with SessionLocal() as db:
        result = run(db, initialize=args.initialize)
    output = {"result": result}
    if not args.initialize:
        path, digest = write_evidence("SM-LD-01", result)
        output.update({"evidence": str(path), "sha256": digest})
    print(json.dumps(output, sort_keys=True))
    if result["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
