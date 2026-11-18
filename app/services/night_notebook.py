from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.models.user import User


@contextmanager
def owner_write(db: Session, user_id: int):
    """Start a fresh write transaction and serialize mutations by authenticated owner."""
    db.rollback()
    with db.begin():
        if db.get_bind().dialect.name == "sqlite":
            connection = db.connection()
            if not connection.connection.driver_connection.in_transaction:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
        user = db.scalar(select(User).where(User.id == user_id).with_for_update(key_share=True))
        if user is None or getattr(user, "is_system", False):
            raise HTTPException(status_code=401, detail="User not found", headers={"WWW-Authenticate": "Bearer"})
        # The main fallback uses trader auth without the Wave 1 demo lifecycle.
        active_check = getattr(security, "require_active_user", None)
        if active_check is not None:
            active_check(user)
        yield security.get_current_trader(user)


def constraint_name(error: IntegrityError) -> str | None:
    return getattr(getattr(error.orig, "diag", None), "constraint_name", None)


def notebook_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
