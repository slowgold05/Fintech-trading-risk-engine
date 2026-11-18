"""Read customer activity from its existing records and store receipt timestamps."""

from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
import hmac
import logging
import re

from sqlalchemy import Date, DateTime, Integer, Numeric, String, case, cast, func, literal, null, select, union_all
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.core.config import settings
from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.asset import Asset
from app.models.ledger_entry import LedgerEntry
from app.models.night_inbox import NightInboxRead
from app.models.order import Order
from app.models.trade import Trade
from app.schemas.night_inbox import (
    EVENT_KEY_PATTERN, InboxFilter, InboxItem, InboxPage, InboxProvenance, InboxRead, InboxSources,
)


HISTORY_DAYS = 30
CURSOR_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,191}\.[0-9a-f]{64}")
AlertSource = Callable[[int], Select]
logger = logging.getLogger(__name__)


class InvalidCursor(ValueError):
    pass


class EventNotFound(LookupError):
    pass


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _cursor_signature(owner_id: int, inbox_filter: InboxFilter, boundary: str) -> str:
    payload = f"night-inbox/v1:{owner_id}:{inbox_filter}:{boundary}"
    return hmac.new(settings.jwt_secret.encode(), payload.encode(), "sha256").hexdigest()


def _encode_cursor(owner_id: int, inbox_filter: InboxFilter, occurred_at: datetime, event_key: str) -> str:
    payload = f"{occurred_at.isoformat(timespec='microseconds')}|{event_key}"
    boundary = urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{boundary}.{_cursor_signature(owner_id, inbox_filter, boundary)}"


def _decode_cursor(owner_id: int, inbox_filter: InboxFilter, cursor: str) -> tuple[datetime, str]:
    if not CURSOR_PATTERN.fullmatch(cursor):
        raise InvalidCursor
    boundary, signature = cursor.split(".")
    if not hmac.compare_digest(_cursor_signature(owner_id, inbox_filter, boundary), signature):
        raise InvalidCursor
    try:
        stamp, event_key = urlsafe_b64decode(boundary + "=" * (-len(boundary) % 4)).decode().split("|")
        occurred_at = datetime.fromisoformat(stamp)
    except ValueError:
        raise InvalidCursor from None
    if occurred_at.tzinfo is not None or not re.fullmatch(EVENT_KEY_PATTERN, event_key):
        raise InvalidCursor
    return occurred_at, event_key


def _ledger_posting_id(owner_id: int, event_kind: str, *, latest: bool):
    posting_id = func.max(LedgerEntry.id) if latest else func.min(LedgerEntry.id)
    return (
        select(posting_id)
        .where(LedgerEntry.user_id == owner_id, LedgerEntry.event_kind == event_kind)
        .correlate(None)
        .scalar_subquery()
    )


def _nullable(column, column_type):
    return cast(null(), column_type) if column is None else column


def event_projection(
    event_key, kind, occurred_at, *, symbol=None, order_id=None, alert_id=None, side=None,
    quantity=None, price=None, target=None, quote_at=None, session_date=None, provider=None, observed_at=None,
) -> Select:
    """Build a source query with the columns and types shared by the inbox."""
    return select(
        event_key.label("event_key"),
        kind.label("kind"),
        occurred_at.label("occurred_at"),
        _nullable(symbol, String).label("symbol"),
        _nullable(order_id, Integer).label("order_id"),
        _nullable(alert_id, Integer).label("alert_id"),
        _nullable(side, String).label("side"),
        _nullable(quantity, Numeric).label("quantity"),
        _nullable(price, Numeric).label("price"),
        _nullable(target, Numeric).label("target"),
        _nullable(quote_at, DateTime).label("quote_at"),
        _nullable(session_date, Date).label("session_date"),
        _nullable(provider, String).label("provider"),
        _nullable(observed_at, DateTime).label("observed_at"),
    )


def _fills(owner_id: int, latest_reset):
    posted_in_book = (
        select(LedgerEntry.id)
        .where(
            LedgerEntry.user_id == owner_id,
            LedgerEntry.trade_id == Trade.id,
            LedgerEntry.event_kind == "trade",
            LedgerEntry.id > func.coalesce(latest_reset, 0),
        )
        .exists()
    )
    return (
        event_projection(
            literal("fill:") + cast(Trade.id, String), literal("fill"), Trade.executed_at,
            symbol=Asset.symbol, order_id=Trade.order_id, side=Trade.side, quantity=Trade.quantity,
            price=Trade.price_at_execution, quote_at=Trade.simulated_quote_at,
        )
        .select_from(Trade)
        .join(Asset, Asset.id == Trade.asset_id)
        .join(Order, (Order.id == Trade.order_id) & (Order.user_id == owner_id))
        .where(Trade.user_id == owner_id, Trade.demo_seed.is_(False), posted_in_book)
    )


def _demo_events(owner_id: int, latest_reset):
    opening = _ledger_posting_id(owner_id, "opening_snapshot", latest=False)
    # Pick a single posting from each group. Posting IDs order the book even
    # when multiple ledger events were posted in the same UTC second.
    kind = case((LedgerEntry.event_kind == "reset", "demo_reset"), else_="demo_started")
    return event_projection(kind + literal(":") + LedgerEntry.event_id, kind, LedgerEntry.created_at).where(
        LedgerEntry.user_id == owner_id, LedgerEntry.id.in_((opening, latest_reset)),
    )


def _core_sources(owner_id: int, is_demo: bool) -> list[Select]:
    latest_reset = _ledger_posting_id(owner_id, "reset", latest=True)
    sources = [_fills(owner_id, latest_reset)]
    if is_demo:
        sources.append(_demo_events(owner_id, latest_reset))
    return sources


def _eligible(sources: list[Select], as_of: datetime):
    events = (sources[0] if len(sources) == 1 else union_all(*sources)).subquery()
    return (
        select(events)
        .where(events.c.occurred_at.between(as_of - timedelta(days=HISTORY_DAYS), as_of))
        .subquery()
    )


def _with_read_markers(events, owner_id: int):
    return select(events, NightInboxRead.read_at).outerjoin(
        NightInboxRead, (NightInboxRead.user_id == owner_id) & (NightInboxRead.event_key == events.c.event_key),
    )


def _item(row) -> InboxItem:
    source = None
    if row.provider is not None:
        source = InboxProvenance(
            provider=row.provider, basis="raw", session_date=row.session_date,
            observed_at=_utc(row.observed_at) if row.observed_at is not None else None, coverage="available",
        )
    return InboxItem(
        id=row.event_key,
        kind=row.kind,
        occurred_at=_utc(row.occurred_at),
        read_at=_utc(row.read_at) if row.read_at is not None else None,
        symbol=row.symbol,
        order_id=row.order_id,
        alert_id=row.alert_id,
        side=row.side,
        quantity=format(row.quantity, "f") if row.quantity is not None else None,
        price=format(row.price, "f") if row.price is not None else None,
        target=format(row.target, "f") if row.target is not None else None,
        # The pinned execution schema stores the quote time and price, but
        # has no persisted provider to use for a complete Provenance object.
        session_date=row.quote_at.date() if row.quote_at is not None else row.session_date,
        source=source,
    )


def _read_page(
    db: Session, owner_id: int, inbox_filter: InboxFilter, boundary: tuple[datetime, str] | None,
    limit: int, as_of: datetime, sources: list[Select], availability: InboxSources,
) -> InboxPage:
    events = _eligible(sources, as_of)
    marked = _with_read_markers(events, owner_id).subquery()
    unread = marked.c.read_at.is_(None)
    unread_count = db.scalar(select(func.count()).select_from(marked).where(unread))
    page = select(marked)
    if inbox_filter == "unread":
        page = page.where(unread)
    occurred_at, event_key = marked.c.occurred_at, marked.c.event_key
    if boundary is not None:
        stamp, key = boundary
        page = page.where((occurred_at < stamp) | ((occurred_at == stamp) & (event_key < key)))
    rows = db.execute(page.order_by(occurred_at.desc(), event_key.desc()).limit(limit + 1)).all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = _encode_cursor(owner_id, inbox_filter, last.occurred_at, last.event_key)
    return InboxPage(
        items=[_item(row) for row in rows[:limit]], next_cursor=next_cursor, unread_count=unread_count,
        sources=availability, read_at=_utc(as_of),
    )


def list_inbox(
    db: Session, owner_id: int, is_demo: bool, inbox_filter: InboxFilter, cursor: str | None, limit: int,
    alert_source: AlertSource | None = None,
) -> InboxPage:
    boundary = _decode_cursor(owner_id, inbox_filter, cursor) if cursor is not None else None
    with consistent_read(db):
        as_of = snapshot_clock(db)
        sources = _core_sources(owner_id, is_demo)
        if alert_source is not None:
            try:
                # A PostgreSQL error in the optional query must leave the
                # original snapshot usable for the core inbox.
                with db.begin_nested():
                    return _read_page(
                        db, owner_id, inbox_filter, boundary, limit, as_of, [*sources, alert_source(owner_id)],
                        InboxSources(demo=is_demo, alerts=True),
                    )
            except SQLAlchemyError:
                logger.warning("Inbox alert query failed. Checking core sources.")
        return _read_page(db, owner_id, inbox_filter, boundary, limit, as_of, sources, InboxSources(demo=is_demo))


def mark_read(
    db: Session, owner_id: int, is_demo: bool, event_key: str, alert_source: AlertSource | None = None,
) -> InboxRead:
    db.rollback()  # End the implicit transaction opened by authentication.
    with db.begin():
        if event_key.startswith("alert_triggered:"):
            if alert_source is None:
                raise EventNotFound
            sources = [alert_source(owner_id)]
        else:
            sources = _core_sources(owner_id, is_demo)
        events = _eligible(sources, snapshot_clock(db))
        eligible_key = select(literal(owner_id), events.c.event_key).where(events.c.event_key == event_key)
        insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        marker = (
            insert(NightInboxRead)
            .from_select(["user_id", "event_key"], eligible_key)
            .on_conflict_do_nothing(index_elements=["user_id", "event_key"])
            .returning(NightInboxRead.read_at)
        )
        read_at = db.scalar(marker)
        if read_at is None:
            # Under PostgreSQL READ COMMITTED this statement sees a concurrent
            # winning marker and rechecks that its source is still eligible.
            read_at = db.scalar(
                _with_read_markers(events, owner_id).with_only_columns(NightInboxRead.read_at)
                .where(events.c.event_key == event_key)
            )
        if read_at is None:
            raise EventNotFound
        return InboxRead(id=event_key, read_at=_utc(read_at))
