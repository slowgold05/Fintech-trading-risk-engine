from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import MetaData, Table
from sqlalchemy.orm import Session

from app.models.ledger_entry import LedgerEntry
from app.services.ledger_service import ZERO_HASH, _hash


def seed_legacy_book(db: Session, email: str) -> int:
    """Create a trader and opening ledger on a revision that predates demo fields."""
    metadata = MetaData()
    users = Table("users", metadata, autoload_with=db.connection())
    ledger = Table("ledger_entries", metadata, autoload_with=db.connection())
    cash = Decimal("100000")
    user_id = db.execute(users.insert().values(
        email=email, password_hash="fixture", cash_balance=cash,
    ).returning(users.c.id)).scalar_one()
    event_id = uuid4().hex
    created_at = datetime(2026, 11, 4)
    previous_hash = ZERO_HASH
    for account, amount in (("cash", cash), ("offset", -cash)):
        values = dict(
            user_id=user_id, event_id=event_id, event_kind="opening_snapshot", account=account,
            unit="USD", amount=amount, created_at=created_at, previous_hash=previous_hash,
        )
        entry_hash = _hash(LedgerEntry(**values))
        db.execute(ledger.insert().values(**values, entry_hash=entry_hash))
        previous_hash = entry_hash
    return user_id
