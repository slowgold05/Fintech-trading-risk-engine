from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import require_active_user
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
        user = db.scalar(select(User).where(User.id == user_id, ~User.is_system).with_for_update(key_share=True))
        if user is None:
            raise HTTPException(status_code=401, detail="User not found", headers={"WWW-Authenticate": "Bearer"})
        require_active_user(user)
        if user.role != "trader":
            raise HTTPException(status_code=403, detail="Trader role required")
        yield user


def constraint_name(error: IntegrityError) -> str | None:
    return getattr(getattr(error.orig, "diag", None), "constraint_name", None)


def notebook_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
