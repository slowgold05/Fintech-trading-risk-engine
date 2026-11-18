"""Expire old demos while retaining their append-only ledger evidence."""

import argparse
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.order import Order
from app.models.refresh_token import RefreshToken
from app.models.trading_halt import TradingHaltState
from app.models.user import User


def archive_expired(db: Session, *, cutoff: datetime, now: datetime) -> int:
    """Archive at most 100 accounts in the caller's transaction."""
    eligible = (
        User.demo_seed.is_not(None), User.demo_archived_at.is_(None), User.created_at < cutoff,
    )
    if db.scalar(select(User.id).where(*eligible).limit(1)) is None:
        return 0
    # Take the same first lock as order placement so the archive cannot
    # race a match or leave a new resting order on an expired account.
    db.execute(select(TradingHaltState.id).where(TradingHaltState.id == 1).with_for_update()).scalar_one()
    users = list(db.scalars(select(User).where(*eligible).order_by(User.id).limit(100).with_for_update()))
    if not users:
        return 0
    user_ids = [user.id for user in users]
    db.execute(update(Order).where(Order.user_id.in_(user_ids), Order.status == "open")
               .values(status="canceled", canceled_at=now))
    db.execute(update(RefreshToken).where(RefreshToken.user_id.in_(user_ids), RefreshToken.revoked_at.is_(None))
               .values(revoked_at=now))
    for user in users:
        user.demo_archived_at = now
    return len(users)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--older-than-days", type=int, default=7)
    args = parser.parse_args()
    if args.older_than_days < 1:
        parser.error("--older-than-days must be positive")
    if not settings.migration_database_url:
        parser.error("MIGRATION_DATABASE_URL is required for the operator-only archive timestamp")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = now - timedelta(days=args.older_than_days)
    engine = create_engine(settings.migration_database_url)
    total = 0
    try:
        with Session(engine) as db:
            while True:
                with db.begin():
                    count = archive_expired(db, cutoff=cutoff, now=now)
                total += count
                if count < 100:
                    break
    finally:
        engine.dispose()
    print(f"Archived {total} demo account(s)")


if __name__ == "__main__":
    main()
