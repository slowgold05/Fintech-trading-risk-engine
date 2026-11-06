"""One read-only database snapshot for a request.

PostgreSQL uses transaction-scoped REPEATABLE READ READ ONLY, which ends at
rollback and is not a connection setting that returns to the pool. SQLite
explicitly begins a transaction when the driver has not started one, because
its legacy mode does not open a transaction for SELECT. PRAGMA query_only is
not used: it would stick to a pooled connection and break a later write.
"""

from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session


class SnapshotClockError(Exception):
    """The open snapshot did not yield a usable UTC read clock."""


def _python_utc_now() -> datetime:
    """Naive UTC instant. Tests replace this. PostgreSQL does not call it."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_naive_utc(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        parsed = value.strip().replace("Z", "+00:00")
        if " " in parsed and "T" not in parsed:
            parsed = parsed.replace(" ", "T", 1)
        try:
            value = datetime.fromisoformat(parsed)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


@contextmanager
def consistent_read(db: Session):
    """Start a read-only snapshot. A response clock alone does not do this."""
    db.rollback()
    try:
        bind = db.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
        elif bind is not None and bind.dialect.name == "sqlite":
            connection = db.connection()
            # sqlite3 legacy transaction mode does not begin a transaction for SELECT.
            if not connection.connection.driver_connection.in_transaction:
                connection.exec_driver_sql("BEGIN")
        yield db
    finally:
        db.rollback()


def snapshot_clock(db: Session) -> datetime:
    """Fix one precise UTC clock inside the snapshot from consistent_read.

    PostgreSQL ``current_timestamp`` keeps fractional seconds and is the
    transaction timestamp, so it stays on the REPEATABLE READ view. SQLite
    ``CURRENT_TIMESTAMP`` is whole seconds. A row written earlier in that
    same second would compare as future. SQLite must read one database page
    before the Python sample: a constant ``SELECT 1`` reads no page and does
    not pin a WAL snapshot. Later reads in the same transaction keep the view
    that page opened. The instant is not a grace window: a later fraction is
    still future, and an equal timestamp is not.
    """
    bind = db.get_bind()
    dialect = bind.dialect.name if bind is not None else ""
    if dialect == "postgresql":
        raw = db.execute(text("SELECT current_timestamp AS market_read_at")).scalar_one()
        clock = _as_naive_utc(raw)
    else:
        # One schema row is enough to open the WAL snapshot. Do this before
        # the Python clock so a commit during the sample stays invisible.
        db.execute(text("SELECT name AS market_read_at FROM sqlite_master LIMIT 1")).scalar_one()
        clock = _as_naive_utc(_python_utc_now())
    if clock is None:
        raise SnapshotClockError("snapshot clock is missing")
    return clock
