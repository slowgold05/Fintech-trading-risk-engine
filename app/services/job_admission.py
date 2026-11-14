"""Per-owner admission for research and forecast jobs.

The caller's auth read is rolled back, then the owner row is locked in the same
transaction that counts pending jobs and inserts the new one. SQLite takes a
reserved lock with BEGIN IMMEDIATE. A lock timeout becomes a retryable 503.
"""

from contextlib import contextmanager

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models.user import User

BUSY_DETAIL = "Job admission is temporarily unavailable. Retry."


@contextmanager
def admission_transaction(db: Session):
    db.rollback()
    try:
        bind = db.get_bind()
        if bind is not None and bind.dialect.name == "sqlite":
            _begin_sqlite_immediate(db)
        yield
        db.commit()
    except Exception as exc:
        db.rollback()
        if _is_sqlite_busy(db, exc):
            raise HTTPException(status_code=503, detail=BUSY_DETAIL) from None
        raise


def lock_owner(db: Session, owner_id: int) -> None:
    found = db.execute(
        select(User.id).where(User.id == owner_id).with_for_update()
    ).scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=401, detail="User not found")


def _begin_sqlite_immediate(db: Session) -> None:
    connection = db.connection()
    driver = connection.connection.driver_connection
    if driver.in_transaction:
        connection.exec_driver_sql("ROLLBACK")
    connection.exec_driver_sql("BEGIN IMMEDIATE")


def _is_sqlite_busy(db: Session, exc: BaseException) -> bool:
    if not isinstance(exc, OperationalError):
        return False
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "sqlite":
        return False
    orig = getattr(exc, "orig", None)
    if getattr(orig, "sqlite_errorcode", None) in {5, 6}:
        return True
    message = str(orig or "").lower()
    return message.startswith("database is locked") or message.startswith("database is busy")
