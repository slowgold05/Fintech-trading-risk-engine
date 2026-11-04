from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.ops_state import DetectionCursor


AML = "aml"
SURVEILLANCE = "surveillance"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def read_since(db: Session, name: str, current: datetime, overlap: timedelta) -> datetime:
    row = db.get(DetectionCursor, name)
    interval = timedelta(hours=settings.scheduled_job_interval_hours)
    since = current - max(overlap, interval)
    if row is not None and row.scanned_through is not None:
        since = min(since, row.scanned_through - overlap)
    if row is not None and row.pending_since is not None:
        since = min(since, row.pending_since)
    return since


def advance_cursor(db: Session, name: str, scanned_through: datetime) -> None:
    row = db.get(DetectionCursor, name)
    if row is None:
        db.add(DetectionCursor(
            name=name, scanned_through=scanned_through, pending_since=None, updated_at=scanned_through,
        ))
        return
    row.scanned_through = scanned_through
    row.pending_since = None
    row.updated_at = scanned_through


def mark_detection_pending(db: Session, name: str, pending_since: datetime) -> None:
    row = db.get(DetectionCursor, name)
    if row is None:
        db.add(DetectionCursor(
            name=name, scanned_through=None, pending_since=pending_since, updated_at=pending_since,
        ))
        return
    if row.pending_since is None or pending_since < row.pending_since:
        row.pending_since = pending_since
    row.updated_at = _now()


def lock_cursor(db: Session, name: str, now: datetime) -> None:
    db.execute(text(
        "INSERT INTO detection_cursors (name, scanned_through, pending_since, updated_at) "
        "VALUES (:name, NULL, NULL, :updated_at) ON CONFLICT (name) DO NOTHING"
    ), {"name": name, "updated_at": now})
    db.execute(
        select(DetectionCursor)
        .where(DetectionCursor.name == name)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def commit_scan(db: Session, name: str, scanned_through: datetime, overlap: timedelta, work) -> dict:
    since = scanned_through
    try:
        lock_cursor(db, name, scanned_through)
        since = read_since(db, name, scanned_through, overlap)
        opened, rules = work(since)
        advance_cursor(db, name, scanned_through)
        db.commit()
        return {"opened": opened, "rules": rules}
    except Exception:
        db.rollback()
        mark_detection_pending(db, name, since)
        db.commit()
        raise
