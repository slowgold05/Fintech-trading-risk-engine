from datetime import datetime, timedelta

from sqlalchemy import or_, text, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.ops_state import SchedulerLock


def acquire_scheduler(db: Session, owner: str, now: datetime, stale_before: datetime) -> bool:
    interval = timedelta(hours=settings.scheduled_job_interval_hours)
    db.execute(text(
        "INSERT INTO scheduler_locks (id, owner, acquired_at, next_due) VALUES (1, NULL, NULL, NULL) "
        "ON CONFLICT (id) DO NOTHING"
    ))
    db.commit()
    won = db.execute(
        update(SchedulerLock)
        .where(SchedulerLock.id == 1)
        .where(or_(SchedulerLock.next_due.is_(None), SchedulerLock.next_due <= now))
        .where(or_(SchedulerLock.owner.is_(None), SchedulerLock.acquired_at < stale_before))
        .values(owner=owner, acquired_at=now, next_due=now + interval)
        .returning(SchedulerLock.id)
        .execution_options(synchronize_session="fetch")
    ).scalar_one_or_none()
    db.commit()
    return won is not None


def release_scheduler(db: Session, owner: str) -> None:
    db.execute(
        update(SchedulerLock)
        .where(SchedulerLock.id == 1, SchedulerLock.owner == owner)
        .values(owner=None, acquired_at=None)
    )
    db.commit()
