"""Read customer activity from its existing records and store receipt timestamps."""

from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timedelta, timezone
import hmac
import re

from sqlalchemy import DateTime, Integer, Numeric, String, case, cast, func, literal, null, select, union_all
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.asset import Asset
from app.models.ledger_entry import LedgerEntry
from app.models.night_inbox import NightInboxRead
from app.models.order import Order
from app.models.trade import Trade
from app.schemas.night_inbox import EVENT_KEY_PATTERN, InboxFilter, InboxItem, InboxPage, InboxRead, InboxSources


HISTORY_DAYS = 30
CURSOR_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,191}\.[0-9a-f]{64}")


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
        select(
            (literal("fill:") + cast(Trade.id, String)).label("event_key"),
            literal("fill").label("kind"),
            Trade.executed_at.label("occurred_at"),
            Asset.symbol,
            Trade.order_id,
            Trade.side,
            Trade.quantity,
            Trade.price_at_execution.label("price"),
            Trade.simulated_quote_at.label("quote_at"),
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
    return (
        select(
            (kind + literal(":") + LedgerEntry.event_id).label("event_key"),
            kind.label("kind"),
            LedgerEntry.created_at.label("occurred_at"),
            cast(null(), String).label("symbol"),
            cast(null(), Integer).label("order_id"),
            cast(null(), String).label("side"),
            cast(null(), Numeric).label("quantity"),
            cast(null(), Numeric).label("price"),
            cast(null(), DateTime).label("quote_at"),
        )
        .where(LedgerEntry.user_id == owner_id, LedgerEntry.id.in_((opening, latest_reset)))
    )


def _events(owner_id: int, is_demo: bool):
    latest_reset = _ledger_posting_id(owner_id, "reset", latest=True)
    fills = _fills(owner_id, latest_reset)
    return (union_all(fills, _demo_events(owner_id, latest_reset)) if is_demo else fills).subquery()


def _eligible(owner_id: int, is_demo: bool, as_of: datetime):
    events = _events(owner_id, is_demo)
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
    return InboxItem(
        id=row.event_key,
        kind=row.kind,
        occurred_at=_utc(row.occurred_at),
        read_at=_utc(row.read_at) if row.read_at is not None else None,
        symbol=row.symbol,
        order_id=row.order_id,
        side=row.side,
        quantity=format(row.quantity, "f") if row.quantity is not None else None,
        price=format(row.price, "f") if row.price is not None else None,
        # The pinned execution schema stores the quote time and price, but
        # has no persisted provider to use for a complete Provenance object.
        session_date=row.quote_at.date() if row.quote_at is not None else None,
    )


def list_inbox(
    db: Session, owner_id: int, is_demo: bool, inbox_filter: InboxFilter, cursor: str | None, limit: int
) -> InboxPage:
    boundary = _decode_cursor(owner_id, inbox_filter, cursor) if cursor is not None else None
    with consistent_read(db):
        as_of = snapshot_clock(db)
        events = _eligible(owner_id, is_demo, as_of)
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
            sources=InboxSources(demo=is_demo), read_at=_utc(as_of),
        )


def mark_read(db: Session, owner_id: int, is_demo: bool, event_key: str) -> InboxRead:
    db.rollback()  # End the implicit transaction opened by authentication.
    with db.begin():
        events = _eligible(owner_id, is_demo, snapshot_clock(db))
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
